/**
 * firestore.rules.test.mjs — Real Firestore Security Rules Test Suite
 * 
 * Uses @firebase/rules-unit-testing to evaluate Cloud Firestore Security Rules
 * against the local Firebase Firestore Emulator.
 * 
 * Target: ../../firestore.rules
 * Project: sri-kamatchi-traders-test (Isolated mock project)
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} = require('@firebase/rules-unit-testing');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RULES_PATH = path.resolve(__dirname, '../../firestore.rules');

const PROJECT_ID = 'sri-kamatchi-rules-test';
const RULES_CONTENT = fs.readFileSync(RULES_PATH, 'utf8');

// Test Identities
const CUSTOMER_ALICE = { uid: 'cust_alice_101', email: 'alice@example.com' };
const CUSTOMER_BOB   = { uid: 'cust_bob_202',   email: 'bob@example.com' };
const ADMIN_USER     = { uid: 'admin_ravi_999', email: 'ravi@srikamatchi.com' };

let testEnv;

// Sample Valid Order Payload
function makeValidOrder(userId, key) {
  return {
    userId: userId,
    userEmail: `${userId}@example.com`,
    customerName: 'Karthik Raja',
    phone: '9840123456',
    deliveryAddress: {
      addressLine1: '14 Car Street',
      addressLine2: 'Near East Gate',
      city: 'Madurai',
      state: 'Tamil Nadu',
      pincode: '625001'
    },
    items: [
      {
        productId: 'prod_ghee_500ml',
        variantId: '500ml',
        quantity: 2,
        unitPrice: 350,
        lineTotal: 700
      }
    ],
    subtotal: 700,
    deliveryCharge: 40,
    total: 740,
    notes: 'Please ring bell',
    status: 'placed',
    paymentStatus: 'pending',
    paymentMethod: 'cash_on_delivery',
    idempotencyKey: key,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

describe('Sri Kamatchi Amman Traders — Firestore Security Rules Tests', () => {

  before(async () => {
    // Connect to Firestore Emulator
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: RULES_CONTENT,
        host: process.env.FIRESTORE_EMULATOR_HOST ? process.env.FIRESTORE_EMULATOR_HOST.split(':')[0] : '127.0.0.1',
        port: process.env.FIRESTORE_EMULATOR_HOST ? parseInt(process.env.FIRESTORE_EMULATOR_HOST.split(':')[1], 10) : 8080
      }
    });
  });

  after(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  beforeEach(async () => {
    if (testEnv) {
      await testEnv.clearFirestore();

      // Seed initial administrative and catalog documents with security rules bypassed
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const adminDb = context.firestore();

        // 1. Seed Admin user identity
        await adminDb.doc(`admins/${ADMIN_USER.uid}`).set({
          role: 'admin',
          grantedAt: new Date()
        });
        await adminDb.doc(`users/${ADMIN_USER.uid}`).set({
          uid: ADMIN_USER.uid,
          email: ADMIN_USER.email,
          role: 'admin',
          displayName: 'Ravi Admin'
        });

        // 2. Seed active and inactive products
        await adminDb.doc('products/prod_active_1').set({
          name: 'Pure Cow Ghee',
          category: 'ghee',
          price: 350,
          stock: 50,
          isActive: true
        });
        await adminDb.doc('products/prod_inactive_2').set({
          name: 'Draft Sesame Oil',
          category: 'oil',
          price: 220,
          stock: 0,
          isActive: false
        });

        // 3. Seed category
        await adminDb.doc('categories/cat_ghee').set({
          name: 'Ghee & Butter',
          slug: 'ghee'
        });
      });
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 1. ORDER SECURITY TESTS
  // ─────────────────────────────────────────────────────────────
  describe('1. Orders Collection Security', () => {

    test('1.1 Unauthenticated order creation is denied', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      const key = 'ord_unauth_key_111111';
      const order = makeValidOrder('anon_user', key);
      await assertFails(db.doc(`orders/${key}`).set(order));
    });

    test('1.2 Authenticated customer can create a valid order for themselves', async () => {
      const db = testEnv.authenticatedContext(CUSTOMER_ALICE.uid, { email: CUSTOMER_ALICE.email }).firestore();
      const key = `ord_${CUSTOMER_ALICE.uid.slice(0, 8)}_1234567890_abc`;
      const order = makeValidOrder(CUSTOMER_ALICE.uid, key);
      await assertSucceeds(db.doc(`orders/${key}`).set(order));
    });

    test('1.3 Customer cannot create an order for another user', async () => {
      const db = testEnv.authenticatedContext(CUSTOMER_ALICE.uid, { email: CUSTOMER_ALICE.email }).firestore();
      const key = `ord_${CUSTOMER_BOB.uid.slice(0, 8)}_1234567890_abc`;
      const spoofedOrder = makeValidOrder(CUSTOMER_BOB.uid, key); // Alice tries to create order owned by Bob
      await assertFails(db.doc(`orders/${key}`).set(spoofedOrder));
    });

    test('1.4 Customer cannot read another customer’s order', async () => {
      // First, create Alice's order with rules disabled
      const key = `ord_${CUSTOMER_ALICE.uid.slice(0, 8)}_1234567890_abc`;
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().doc(`orders/${key}`).set(makeValidOrder(CUSTOMER_ALICE.uid, key));
      });

      // Bob tries to read Alice's order
      const bobDb = testEnv.authenticatedContext(CUSTOMER_BOB.uid, { email: CUSTOMER_BOB.email }).firestore();
      await assertFails(bobDb.doc(`orders/${key}`).get());
    });

    test('1.5 Customer can read their own order', async () => {
      const key = `ord_${CUSTOMER_ALICE.uid.slice(0, 8)}_1234567890_abc`;
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().doc(`orders/${key}`).set(makeValidOrder(CUSTOMER_ALICE.uid, key));
      });

      const aliceDb = testEnv.authenticatedContext(CUSTOMER_ALICE.uid, { email: CUSTOMER_ALICE.email }).firestore();
      await assertSucceeds(aliceDb.doc(`orders/${key}`).get());
    });

    test('1.6 Customer cannot update or delete an existing order', async () => {
      const key = `ord_${CUSTOMER_ALICE.uid.slice(0, 8)}_1234567890_abc`;
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().doc(`orders/${key}`).set(makeValidOrder(CUSTOMER_ALICE.uid, key));
      });

      const aliceDb = testEnv.authenticatedContext(CUSTOMER_ALICE.uid, { email: CUSTOMER_ALICE.email }).firestore();
      await assertFails(aliceDb.doc(`orders/${key}`).update({ status: 'cancelled' }));
      await assertFails(aliceDb.doc(`orders/${key}`).delete());
    });

    test('1.7 Customer cannot overwrite an existing order using setDoc', async () => {
      const key = `ord_${CUSTOMER_ALICE.uid.slice(0, 8)}_1234567890_abc`;
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().doc(`orders/${key}`).set(makeValidOrder(CUSTOMER_ALICE.uid, key));
      });

      const aliceDb = testEnv.authenticatedContext(CUSTOMER_ALICE.uid, { email: CUSTOMER_ALICE.email }).firestore();
      const alteredOrder = makeValidOrder(CUSTOMER_ALICE.uid, key);
      alteredOrder.total = 100; // attempt overwrite with lower total
      await assertFails(aliceDb.doc(`orders/${key}`).set(alteredOrder));
    });

    test('1.8 The document ID and idempotency key must match', async () => {
      const aliceDb = testEnv.authenticatedContext(CUSTOMER_ALICE.uid, { email: CUSTOMER_ALICE.email }).firestore();
      const docId = `ord_${CUSTOMER_ALICE.uid.slice(0, 8)}_key_AAA`;
      const order = makeValidOrder(CUSTOMER_ALICE.uid, 'mismatched_key_BBB');
      await assertFails(aliceDb.doc(`orders/${docId}`).set(order));
    });

    test('1.9 Order creation must enforce initial status == "placed" and paymentStatus == "pending"', async () => {
      const aliceDb = testEnv.authenticatedContext(CUSTOMER_ALICE.uid, { email: CUSTOMER_ALICE.email }).firestore();

      // Attempt status: 'confirmed'
      const key1 = `ord_${CUSTOMER_ALICE.uid.slice(0, 8)}_k1`;
      const order1 = makeValidOrder(CUSTOMER_ALICE.uid, key1);
      order1.status = 'confirmed';
      await assertFails(aliceDb.doc(`orders/${key1}`).set(order1));

      // Attempt paymentStatus: 'paid'
      const key2 = `ord_${CUSTOMER_ALICE.uid.slice(0, 8)}_k2`;
      const order2 = makeValidOrder(CUSTOMER_ALICE.uid, key2);
      order2.paymentStatus = 'paid';
      await assertFails(aliceDb.doc(`orders/${key2}`).set(order2));
    });

    test('1.10 Order creation must enforce positive subtotal and valid contact details', async () => {
      const aliceDb = testEnv.authenticatedContext(CUSTOMER_ALICE.uid, { email: CUSTOMER_ALICE.email }).firestore();

      // Zero subtotal
      const k1 = `ord_${CUSTOMER_ALICE.uid.slice(0, 8)}_kzero`;
      const orderZero = makeValidOrder(CUSTOMER_ALICE.uid, k1);
      orderZero.subtotal = 0;
      await assertFails(aliceDb.doc(`orders/${k1}`).set(orderZero));

      // Invalid phone (not 10 digits starting with 6-9)
      const k2 = `ord_${CUSTOMER_ALICE.uid.slice(0, 8)}_kphone`;
      const orderBadPhone = makeValidOrder(CUSTOMER_ALICE.uid, k2);
      orderBadPhone.phone = '123456';
      await assertFails(aliceDb.doc(`orders/${k2}`).set(orderBadPhone));

      // Unexpected privileged field injection
      const k3 = `ord_${CUSTOMER_ALICE.uid.slice(0, 8)}_kinject`;
      const orderInjected = makeValidOrder(CUSTOMER_ALICE.uid, k3);
      orderInjected.isVIPCustomer = true;
      await assertFails(aliceDb.doc(`orders/${k3}`).set(orderInjected));
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. USER PROFILE & ADMIN PRIVILEGE ESCALATION
  // ─────────────────────────────────────────────────────────────
  describe('2. User Profiles & Admin Privilege Escalation', () => {

    test('2.1 Customer cannot grant themselves admin privileges during profile creation', async () => {
      const aliceDb = testEnv.authenticatedContext(CUSTOMER_ALICE.uid, { email: CUSTOMER_ALICE.email }).firestore();
      await assertFails(aliceDb.doc(`users/${CUSTOMER_ALICE.uid}`).set({
        uid: CUSTOMER_ALICE.uid,
        email: CUSTOMER_ALICE.email,
        role: 'admin' // illegal self-promotion
      }));
    });

    test('2.2 Customer can create their own profile with role == "customer"', async () => {
      const aliceDb = testEnv.authenticatedContext(CUSTOMER_ALICE.uid, { email: CUSTOMER_ALICE.email }).firestore();
      await assertSucceeds(aliceDb.doc(`users/${CUSTOMER_ALICE.uid}`).set({
        uid: CUSTOMER_ALICE.uid,
        email: CUSTOMER_ALICE.email,
        role: 'customer'
      }));
    });

    test('2.3 Customer cannot escalate existing profile role from customer to admin', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().doc(`users/${CUSTOMER_ALICE.uid}`).set({
          uid: CUSTOMER_ALICE.uid,
          email: CUSTOMER_ALICE.email,
          role: 'customer'
        });
      });

      const aliceDb = testEnv.authenticatedContext(CUSTOMER_ALICE.uid, { email: CUSTOMER_ALICE.email }).firestore();
      await assertFails(aliceDb.doc(`users/${CUSTOMER_ALICE.uid}`).update({
        role: 'admin'
      }));
    });

    test('2.4 Customer cannot write to /admins collection', async () => {
      const aliceDb = testEnv.authenticatedContext(CUSTOMER_ALICE.uid, { email: CUSTOMER_ALICE.email }).firestore();
      await assertFails(aliceDb.doc(`admins/${CUSTOMER_ALICE.uid}`).set({
        role: 'admin'
      }));
    });

    test('2.5 Customer cannot list or enumerate /admins collection', async () => {
      const aliceDb = testEnv.authenticatedContext(CUSTOMER_ALICE.uid, { email: CUSTOMER_ALICE.email }).firestore();
      await assertFails(aliceDb.collection('admins').get());
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. PRODUCTS & CATEGORIES SECURITY
  // ─────────────────────────────────────────────────────────────
  describe('3. Products & Categories Security', () => {

    test('3.1 Anyone can read active products', async () => {
      const unauthDb = testEnv.unauthenticatedContext().firestore();
      await assertSucceeds(unauthDb.doc('products/prod_active_1').get());
    });

    test('3.2 Non-admins cannot read inactive products', async () => {
      const aliceDb = testEnv.authenticatedContext(CUSTOMER_ALICE.uid).firestore();
      await assertFails(aliceDb.doc('products/prod_inactive_2').get());
    });

    test('3.3 Non-admins cannot create, update, or delete products', async () => {
      const aliceDb = testEnv.authenticatedContext(CUSTOMER_ALICE.uid).firestore();
      await assertFails(aliceDb.doc('products/prod_new').set({
        name: 'Hacked Product',
        category: 'oil',
        price: 1,
        stock: 10,
        isActive: true
      }));
      await assertFails(aliceDb.doc('products/prod_active_1').update({ price: 10 }));
      await assertFails(aliceDb.doc('products/prod_active_1').delete());
    });

    test('3.4 Admin can create, update, delete products and read inactive products', async () => {
      const adminDb = testEnv.authenticatedContext(ADMIN_USER.uid, { email: ADMIN_USER.email }).firestore();
      // Read inactive product
      await assertSucceeds(adminDb.doc('products/prod_inactive_2').get());
      // Create new product
      await assertSucceeds(adminDb.doc('products/prod_admin_new').set({
        name: 'Premium Gingelly Oil',
        category: 'oil',
        price: 260,
        stock: 100,
        isActive: true
      }));
      // Update product
      await assertSucceeds(adminDb.doc('products/prod_admin_new').update({ stock: 95 }));
      // Delete product
      await assertSucceeds(adminDb.doc('products/prod_admin_new').delete());
    });

    test('3.5 Non-admins cannot write to categories', async () => {
      const aliceDb = testEnv.authenticatedContext(CUSTOMER_ALICE.uid).firestore();
      await assertFails(aliceDb.doc('categories/cat_new').set({ name: 'Spices', slug: 'spices' }));
      await assertFails(aliceDb.doc('categories/cat_ghee').delete());
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. REVIEWS COLLECTION SECURITY
  // ─────────────────────────────────────────────────────────────
  describe('4. Reviews Collection Security', () => {

    test('4.1 Unauthenticated user cannot create reviews', async () => {
      const unauthDb = testEnv.unauthenticatedContext().firestore();
      await assertFails(unauthDb.doc('reviews/rev_1').set({
        userId: 'anon',
        productId: 'prod_active_1',
        rating: 5,
        comment: 'Great quality'
      }));
    });

    test('4.2 Authenticated user can create review with their own UID and valid schema', async () => {
      const aliceDb = testEnv.authenticatedContext(CUSTOMER_ALICE.uid, { email: CUSTOMER_ALICE.email }).firestore();
      await assertSucceeds(aliceDb.doc('reviews/rev_alice_1').set({
        userId: CUSTOMER_ALICE.uid,
        userName: 'Alice',
        productId: 'prod_active_1',
        rating: 5,
        comment: 'Aromatic and fresh ghee!',
        createdAt: new Date()
      }));
    });

    test('4.3 Review creation must reject rating out of bounds or extra fields', async () => {
      const aliceDb = testEnv.authenticatedContext(CUSTOMER_ALICE.uid, { email: CUSTOMER_ALICE.email }).firestore();

      // Rating = 6 (out of bounds)
      await assertFails(aliceDb.doc('reviews/rev_bad_rating').set({
        userId: CUSTOMER_ALICE.uid,
        userName: 'Alice',
        productId: 'prod_active_1',
        rating: 6,
        comment: 'Too high rating',
        createdAt: new Date()
      }));

      // Extra malicious field injection
      await assertFails(aliceDb.doc('reviews/rev_injected').set({
        userId: CUSTOMER_ALICE.uid,
        userName: 'Alice',
        productId: 'prod_active_1',
        rating: 5,
        comment: 'Nice',
        createdAt: new Date(),
        verifiedBuyerForced: true
      }));
    });

    test('4.4 Customer cannot update another user’s review', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().doc('reviews/rev_alice_1').set({
          userId: CUSTOMER_ALICE.uid,
          userName: 'Alice',
          productId: 'prod_active_1',
          rating: 5,
          comment: 'Original comment'
        });
      });

      const bobDb = testEnv.authenticatedContext(CUSTOMER_BOB.uid).firestore();
      await assertFails(bobDb.doc('reviews/rev_alice_1').update({ comment: 'Tampered comment by Bob' }));
      await assertFails(bobDb.doc('reviews/rev_alice_1').delete());
    });

    test('4.5 Review author can update and delete their own review', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().doc('reviews/rev_alice_1').set({
          userId: CUSTOMER_ALICE.uid,
          userName: 'Alice',
          productId: 'prod_active_1',
          rating: 5,
          comment: 'Original comment'
        });
      });

      const aliceDb = testEnv.authenticatedContext(CUSTOMER_ALICE.uid).firestore();
      await assertSucceeds(aliceDb.doc('reviews/rev_alice_1').update({ rating: 4 }));
      await assertSucceeds(aliceDb.doc('reviews/rev_alice_1').delete());
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 5. UNMATCHED PATHS / DEFAULT DENY & ADMIN POWERS
  // ─────────────────────────────────────────────────────────────
  describe('5. Unmatched Paths & Administrative Authorization', () => {

    test('5.1 Unmatched Firestore collections are strictly denied by default', async () => {
      const aliceDb = testEnv.authenticatedContext(CUSTOMER_ALICE.uid).firestore();
      const adminDb = testEnv.authenticatedContext(ADMIN_USER.uid).firestore();

      await assertFails(aliceDb.doc('system_settings/config').get());
      await assertFails(aliceDb.doc('audit_logs/log_1').set({ event: 'test' }));
      await assertFails(adminDb.doc('system_settings/config').get());
    });

    test('5.2 Admin can read all orders and update order status', async () => {
      const key = `ord_${CUSTOMER_ALICE.uid.slice(0, 8)}_1234567890_abc`;
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().doc(`orders/${key}`).set(makeValidOrder(CUSTOMER_ALICE.uid, key));
      });

      const adminDb = testEnv.authenticatedContext(ADMIN_USER.uid, { email: ADMIN_USER.email }).firestore();
      await assertSucceeds(adminDb.doc(`orders/${key}`).get());
      await assertSucceeds(adminDb.doc(`orders/${key}`).update({ status: 'confirmed' }));
      await assertSucceeds(adminDb.doc(`orders/${key}`).update({ status: 'shipped' }));
    });

    test('5.3 Admin can read all user profiles and list /admins', async () => {
      const adminDb = testEnv.authenticatedContext(ADMIN_USER.uid, { email: ADMIN_USER.email }).firestore();
      await assertSucceeds(adminDb.collection('users').get());
      await assertSucceeds(adminDb.collection('admins').get());
    });
  });
});
