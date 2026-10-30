/**
 * firestore.js — Firestore Database Operations
 * 
 * Provides CRUD functions for Firestore collections:
 * - User Profiles (Customer role enforced, self-promotion blocked)
 * - Products (Admin-controlled, variant-aware, real-time sync)
 * - Orders (Admin review, real order tracking)
 * - Admin authorization checks
 * 
 * SECURITY:
 * - All writes are strictly validated by Firestore Security Rules.
 * - Customer role assignment cannot be altered by client update requests.
 * - Non-admin users cannot write to products or administrative records.
 */

import { db, auth } from './firebase-config.js';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  limit,
  runTransaction
} from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js';


// ═══════════════════════════════════════════════
// ADMIN VERIFICATION HELPERS
// ═══════════════════════════════════════════════

/**
 * Check if a user has administrator privileges in Firestore.
 * Verifies both the user document's 'role' field and the server-managed /admins allowlist.
 * 
 * @param {string} uid - Firebase Auth user ID
 * @returns {Promise<boolean>}
 */
export async function checkIsAdminInFirestore(uid) {
  if (!db || !uid) return false;

  try {
    // 1. Check user profile document
    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists() && userSnap.data().role === 'admin') {
      return true;
    }

    // 2. Check server-managed /admins collection allowlist
    const adminRef = doc(db, 'admins', uid);
    const adminSnap = await getDoc(adminRef);
    if (adminSnap.exists()) {
      return true;
    }

    return false;
  } catch (error) {
    console.warn('[Firestore] checkIsAdminInFirestore check failed:', error.message);
    return false;
  }
}


// ═══════════════════════════════════════════════
// USER PROFILES
// ═══════════════════════════════════════════════

/**
 * Fetch a user profile document from Firestore.
 * 
 * @param {string} uid - The Firebase Auth UID.
 * @returns {Promise<Object|null>} The user profile data, or null if not found.
 */
export async function getUserProfile(uid) {
  if (!db || !uid) return null;

  try {
    const userRef = doc(db, 'users', uid);
    const snapshot = await getDoc(userRef);

    if (snapshot.exists()) {
      return { id: snapshot.id, ...snapshot.data() };
    }
    return null;
  } catch (error) {
    console.error('[Firestore] getUserProfile error:', error);
    throw error;
  }
}


/**
 * Create a new user profile in Firestore.
 * Called on first Google Sign-In. Role is ALWAYS hardcoded to "customer".
 * 
 * @param {import('firebase/auth').User} user - The Firebase Auth user object.
 * @returns {Promise<Object>} The created profile data.
 */
export async function createUserProfile(user) {
  if (!db || !user) return null;

  const profileData = {
    uid:         user.uid,
    displayName: user.displayName || '',
    email:       user.email || '',
    photoURL:    user.photoURL || '',
    phone:       '',
    role:        'customer', // ALWAYS customer. Enforced by security rules.
    addresses:   [],
    createdAt:   serverTimestamp(),
    updatedAt:   serverTimestamp()
  };

  try {
    const userRef = doc(db, 'users', user.uid);
    await setDoc(userRef, profileData);
    console.log('[Firestore] Created user profile for:', user.email);
    return { id: user.uid, ...profileData };
  } catch (error) {
    console.error('[Firestore] createUserProfile error:', error);
    throw error;
  }
}


/**
 * Update a user's own profile. 
 * Strips 'role', 'uid', 'email', and 'createdAt' from updates
 * to prevent privilege escalation or identity spoofing.
 * 
 * @param {string} uid - The user's Firebase Auth UID.
 * @param {Object} updates - Fields to update.
 * @returns {Promise<boolean>} True if update succeeded.
 */
export async function updateUserProfile(uid, updates) {
  if (!db || !uid) return false;

  const safeUpdates = { ...updates };
  delete safeUpdates.role;
  delete safeUpdates.uid;
  delete safeUpdates.email;
  delete safeUpdates.createdAt;

  safeUpdates.updatedAt = serverTimestamp();

  try {
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, safeUpdates);
    console.log('[Firestore] Updated user profile for:', uid);
    return true;
  } catch (error) {
    console.error('[Firestore] updateUserProfile error:', error);
    throw error;
  }
}


// ═══════════════════════════════════════════════
// PRODUCTS (Phase 3: Real Product Management)
// ═══════════════════════════════════════════════

/**
 * Standardize and compute product variant fields to ensure consistent
 * data model between variants, catalog sorting, and storefront cards.
 * 
 * @param {Object} rawData - Product data with raw variants array
 * @returns {Object} Normalized product payload ready for Firestore
 */
function normalizeProductData(rawData) {
  // Ensure variants array exists
  let variants = Array.isArray(rawData.variants) && rawData.variants.length > 0
    ? rawData.variants
    : [
        {
          size: rawData.unit || '1L',
          sku: `${(rawData.category || 'OIL').toUpperCase().slice(0, 3)}-1L`,
          price: Number(rawData.price) || 0,
          discountPrice: rawData.discountPrice ? Number(rawData.discountPrice) : null,
          stock: Number(rawData.stock) || 0,
          isDefault: true
        }
      ];

  // Clean, sanitize, and assign deterministic unique variant IDs
  let hasDefault = false;
  variants = variants.map((v, index) => {
    const isDefault = v.isDefault === true || (!hasDefault && index === 0);
    if (isDefault) hasDefault = true;

    const cleanSize = (v.size || '1L').trim();
    const cleanSku = (v.sku || '').trim().toUpperCase();
    const sizeSlug = cleanSize.toLowerCase().replace(/[^a-z0-9]/g, '');
    const variantId = v.id || v.variantId || (cleanSku ? cleanSku.toLowerCase() : `var-${sizeSlug || index + 1}`);

    return {
      id: variantId,
      variantId: variantId,
      size: cleanSize,
      sku: cleanSku || `${(rawData.category || 'OIL').toUpperCase().slice(0, 3)}-${cleanSize.toUpperCase()}`,
      price: Math.max(0, Number(v.price) || 0),
      discountPrice: v.discountPrice && Number(v.discountPrice) > 0 ? Number(v.discountPrice) : null,
      stock: Math.max(0, parseInt(v.stock, 10) || 0),
      isDefault: isDefault
    };
  });

  // If no default was picked, mark the first one as default
  if (!hasDefault && variants.length > 0) {
    variants[0].isDefault = true;
  }

  // Find default variant for top-level backward compatibility
  const defaultVariant = variants.find(v => v.isDefault) || variants[0];
  const totalStock = variants.reduce((sum, v) => sum + v.stock, 0);
  const sizeList = variants.map(v => v.size);

  return {
    name: (rawData.name || '').trim(),
    nameTamil: (rawData.nameTamil || '').trim(),
    description: (rawData.description || '').trim(),
    category: (rawData.category || 'sesame').toLowerCase().trim(),
    imageURLs: Array.isArray(rawData.imageURLs) ? rawData.imageURLs : (rawData.imageURL ? [rawData.imageURL] : []),
    imageURL: rawData.imageURL || (Array.isArray(rawData.imageURLs) && rawData.imageURLs[0]) || '',
    variants: variants,
    // Top-level fields derived from default variant for full compatibility:
    price: defaultVariant.price,
    discountPrice: defaultVariant.discountPrice,
    unit: defaultVariant.size,
    sizes: sizeList,
    stock: totalStock,
    isActive: rawData.isActive !== false,
    tags: Array.isArray(rawData.tags) ? rawData.tags : [],
    nutritionInfo: rawData.nutritionInfo || {
      calories: '884 kcal/100ml',
      fat: '100g',
      saturatedFat: '14g'
    },
    rating: Number(rawData.rating) || 5.0,
    reviewCount: Number(rawData.reviewCount) || 0
  };
}


/**
 * Fetch products from Firestore.
 * 
 * @param {Object} options
 * @param {boolean} [options.includeInactive=false] - Whether to include deactivated products (admin only).
 * @param {string} [options.category] - Filter by specific category.
 * @returns {Promise<Array<Object>>} List of products.
 */
export async function getProducts(options = {}) {
  if (!db) return [];

  try {
    const productsRef = collection(db, 'products');
    let q;

    if (options.includeInactive) {
      if (options.category) {
        q = query(productsRef, where('category', '==', options.category));
      } else {
        q = query(productsRef);
      }
    } else {
      if (options.category) {
        q = query(productsRef, where('isActive', '==', true), where('category', '==', options.category));
      } else {
        q = query(productsRef, where('isActive', '==', true));
      }
    }

    const snapshot = await getDocs(q);
    const products = [];
    snapshot.forEach(docSnap => {
      products.push({ id: docSnap.id, ...docSnap.data() });
    });

    return products;
  } catch (error) {
    console.error('[Firestore] getProducts error:', error);
    throw error;
  }
}


/**
 * Fetch a single product document by its Firestore document ID.
 * 
 * @param {string} productId
 * @returns {Promise<Object|null>}
 */
export async function getProductById(productId) {
  if (!db || !productId) return null;

  try {
    const productRef = doc(db, 'products', productId);
    const snap = await getDoc(productRef);
    if (snap.exists()) {
      return { id: snap.id, ...snap.data() };
    }
    return null;
  } catch (error) {
    console.error(`[Firestore] getProductById(${productId}) error:`, error);
    throw error;
  }
}


/**
 * Set up a scoped real-time listener for products.
 * Automatically updates when products are added, edited, or deactivated.
 * 
 * @param {Function} callback - Callback receiving the array of products.
 * @param {Object} [options]
 * @param {boolean} [options.includeInactive=false] - For admin view.
 * @returns {Function} Unsubscribe function.
 */
export function subscribeToProducts(callback, options = {}) {
  if (!db) {
    callback([]);
    return () => {};
  }

  const productsRef = collection(db, 'products');
  let q;

  if (options.includeInactive) {
    q = query(productsRef);
  } else {
    q = query(productsRef, where('isActive', '==', true));
  }

  return onSnapshot(q, (snapshot) => {
    const products = [];
    snapshot.forEach(docSnap => {
      products.push({ id: docSnap.id, ...docSnap.data() });
    });
    callback(products);
  }, (error) => {
    console.error('[Firestore] subscribeToProducts listener error:', error);
    callback([]);
  });
}


/**
 * Create a new product in Firestore.
 * Restricted to administrators by Firestore Security Rules.
 * 
 * @param {Object} productData - Raw product data from form.
 * @returns {Promise<Object>} The created product document with ID.
 */
export async function createProduct(productData) {
  if (!db) throw new Error('Firestore is not initialized.');

  const normalized = normalizeProductData(productData);
  normalized.createdAt = serverTimestamp();
  normalized.updatedAt = serverTimestamp();

  try {
    const productsRef = collection(db, 'products');
    const docRef = await addDoc(productsRef, normalized);
    console.log('[Firestore] Created new product with ID:', docRef.id);
    return { id: docRef.id, ...normalized };
  } catch (error) {
    console.error('[Firestore] createProduct error:', error);
    if (error.code === 'permission-denied') {
      throw new Error('Permission denied: You must be an authorized administrator to create products.');
    }
    throw error;
  }
}


/**
 * Update an existing product in Firestore.
 * Restricted to administrators by Firestore Security Rules.
 * 
 * @param {string} productId - Product ID to update.
 * @param {Object} productData - Updated product fields.
 * @returns {Promise<boolean>} True if update succeeded.
 */
export async function updateProduct(productId, productData) {
  if (!db || !productId) throw new Error('Product ID is required.');

  const normalized = normalizeProductData(productData);
  normalized.updatedAt = serverTimestamp();

  try {
    const productRef = doc(db, 'products', productId);
    await updateDoc(productRef, normalized);
    console.log('[Firestore] Updated product:', productId);
    return true;
  } catch (error) {
    console.error('[Firestore] updateProduct error:', error);
    if (error.code === 'permission-denied') {
      throw new Error('Permission denied: You must be an authorized administrator to update products.');
    }
    throw error;
  }
}


/**
 * Toggle product active status (activate/deactivate).
 * 
 * @param {string} productId
 * @param {boolean} newStatus - True for active, false for inactive.
 * @returns {Promise<boolean>}
 */
export async function toggleProductStatus(productId, newStatus) {
  if (!db || !productId) return false;

  try {
    const productRef = doc(db, 'products', productId);
    await updateDoc(productRef, {
      isActive: Boolean(newStatus),
      updatedAt: serverTimestamp()
    });
    console.log(`[Firestore] Set product ${productId} isActive to ${newStatus}`);
    return true;
  } catch (error) {
    console.error('[Firestore] toggleProductStatus error:', error);
    if (error.code === 'permission-denied') {
      throw new Error('Permission denied: You must be an authorized administrator to change product status.');
    }
    throw error;
  }
}


/**
 * Delete a product from Firestore.
 * Restricted to administrators by Firestore Security Rules.
 * 
 * @param {string} productId
 * @returns {Promise<boolean>}
 */
export async function deleteProduct(productId) {
  if (!db || !productId) return false;

  try {
    const productRef = doc(db, 'products', productId);
    await deleteDoc(productRef);
    console.log('[Firestore] Deleted product:', productId);
    return true;
  } catch (error) {
    console.error('[Firestore] deleteProduct error:', error);
    if (error.code === 'permission-denied') {
      throw new Error('Permission denied: You must be an authorized administrator to delete products.');
    }
    throw error;
  }
}


// ═══════════════════════════════════════════════
// ORDERS (Phase 3: Real Orders Retrieval)
// ═══════════════════════════════════════════════

/**
 * Fetch all actual orders from Firestore.
 * Does NOT generate fake orders; returns real order records or empty list.
 * 
 * @returns {Promise<Array<Object>>}
 */
export async function getOrders() {
  if (!db) return [];

  try {
    const ordersRef = collection(db, 'orders');
    const q = query(ordersRef, orderBy('createdAt', 'desc'), limit(100));
    const snapshot = await getDocs(q);

    const orders = [];
    snapshot.forEach(docSnap => {
      orders.push({ id: docSnap.id, ...docSnap.data() });
    });

    return orders;
  } catch (error) {
    // If index or ordering fails, try without orderBy
    try {
      const ordersRef = collection(db, 'orders');
      const snapshot = await getDocs(ordersRef);
      const orders = [];
      snapshot.forEach(docSnap => {
        orders.push({ id: docSnap.id, ...docSnap.data() });
      });
      return orders;
    } catch (fallbackError) {
      console.warn('[Firestore] getOrders note:', fallbackError.message);
      return [];
    }
  }
}


/**
 * Verify whether an order's prices, line item totals, delivery charge, and grand total
 * match the authoritative product catalog prices.
 * Used by the Admin Dashboard to detect client-side payload tampering before confirmation.
 * 
 * @param {Object} order - Order document data
 * @param {Array<Object>} products - List of active products from Firestore
 * @returns {Object} Integrity audit report { isValid, issues, expectedSubtotal, expectedDeliveryCharge, expectedTotal, priceDiscrepancy }
 */
export function verifyOrderIntegrity(order, products = []) {
  if (!order || !Array.isArray(order.items) || order.items.length === 0) {
    return {
      isValid: false,
      issues: ['Order contains no line items or is malformed.'],
      expectedSubtotal: 0,
      expectedDeliveryCharge: 0,
      expectedTotal: 0,
      priceDiscrepancy: 0
    };
  }

  const issues = [];
  let expectedSubtotal = 0;

  for (const item of order.items) {
    const product = products.find(p => p.id === item.productId);
    if (!product) {
      issues.push(`Product "${item.name || item.productId}" was not found in catalog.`);
      continue;
    }

    const variants = Array.isArray(product.variants) && product.variants.length > 0
      ? product.variants
      : [{
          id: 'default',
          variantId: 'default',
          size: product.unit || '1L',
          price: product.price || 0,
          discountPrice: product.discountPrice || null,
          stock: product.stock || 0
        }];

    const matchedVariant = variants.find(v => 
      (item.variantId && (v.variantId === item.variantId || v.id === item.variantId)) ||
      (item.sku && v.sku === item.sku) ||
      (item.size && v.size === item.size)
    );

    if (!matchedVariant) {
      issues.push(`Variant "${item.size || item.variantId}" for "${product.name}" was not found in catalog.`);
      continue;
    }

    const regularPrice = Math.max(0, Number(matchedVariant.price) || 0);
    const discountPrice = (matchedVariant.discountPrice && Number(matchedVariant.discountPrice) > 0 && Number(matchedVariant.discountPrice) < regularPrice)
      ? Number(matchedVariant.discountPrice)
      : null;
    const authoritativePrice = discountPrice !== null ? discountPrice : regularPrice;

    if (Number(item.unitPrice) !== authoritativePrice) {
      issues.push(
        `Price mismatch for "${product.name} (${matchedVariant.size})": submitted ₹${item.unitPrice}, catalog is ₹${authoritativePrice}.`
      );
    }

    const qty = parseInt(item.quantity, 10) || 1;
    const expectedLineTotal = authoritativePrice * qty;
    if (Number(item.lineTotal) !== expectedLineTotal) {
      issues.push(
        `Line total mismatch for "${product.name}": submitted ₹${item.lineTotal}, expected ₹${expectedLineTotal}.`
      );
    }

    expectedSubtotal += expectedLineTotal;
  }

  const expectedDeliveryCharge = expectedSubtotal >= 999 ? 0 : 40;
  const expectedTotal = expectedSubtotal + expectedDeliveryCharge;

  if (Number(order.subtotal) !== expectedSubtotal) {
    issues.push(`Subtotal mismatch: submitted ₹${order.subtotal}, calculated ₹${expectedSubtotal}.`);
  }

  if (Number(order.deliveryCharge) !== expectedDeliveryCharge) {
    issues.push(`Delivery charge mismatch: submitted ₹${order.deliveryCharge}, calculated ₹${expectedDeliveryCharge}.`);
  }

  if (Number(order.total) !== expectedTotal) {
    issues.push(`Total mismatch: submitted ₹${order.total}, calculated ₹${expectedTotal}.`);
  }

  const priceDiscrepancy = Math.abs((Number(order.total) || 0) - expectedTotal);

  return {
    isValid: issues.length === 0,
    issues,
    expectedSubtotal,
    expectedDeliveryCharge,
    expectedTotal,
    priceDiscrepancy
  };
}


/**
 * Atomically confirm an order and deduct inventory stock from all referenced products.
 * 
 * INVENTORY INTEGRITY GUARANTEES:
 * 1. Must be executed by an authenticated administrator.
 * 2. Order must be in 'placed' status (cannot confirm an already-confirmed or cancelled order).
 * 3. Double-confirmation prevention: checks order.inventoryDeducted === true.
 * 4. Atomic transaction: all product documents and the order document are updated together.
 * 5. All stock values are validated before any write occurs.
 * 6. If ANY item in the order has insufficient stock, the transaction aborts with a descriptive error.
 *    No partial deductions occur.
 * 7. Recalculates both variant-level stock and top-level total product stock.
 * 
 * @param {string} orderId - Document ID in /orders
 * @returns {Promise<Object>} Result object { success: true, orderId, updatedProducts }
 */
export async function confirmOrder(orderId) {
  if (!db || !orderId) throw new Error('Order identifier is required.');

  const orderRef = doc(db, 'orders', orderId);

  try {
    return await runTransaction(db, async (transaction) => {
      // 1. Read order document
      const orderDoc = await transaction.get(orderRef);
      if (!orderDoc.exists()) {
        throw new Error(`Order #${orderId.slice(0, 8)} not found.`);
      }

      const orderData = orderDoc.data();

      // 2. State & Eligibility validations
      if (orderData.status === 'confirmed' || orderData.inventoryDeducted === true) {
        throw new Error('This order has already been confirmed and its inventory has already been deducted.');
      }

      if (orderData.status === 'cancelled') {
        throw new Error('Cannot confirm a cancelled order.');
      }

      if (orderData.status !== 'placed') {
        throw new Error(`Cannot confirm an order in "${orderData.status}" status. Only "placed" orders can be confirmed.`);
      }

      const items = Array.isArray(orderData.items) ? orderData.items : [];
      if (items.length === 0) {
        throw new Error('Order contains no line items to confirm.');
      }

      // 3. Group line items by productId to avoid duplicate reads on the same document reference
      const itemsByProduct = new Map();
      for (const item of items) {
        if (!item.productId) {
          throw new Error('Order item is missing productId.');
        }
        if (!itemsByProduct.has(item.productId)) {
          itemsByProduct.set(item.productId, []);
        }
        itemsByProduct.get(item.productId).push(item);
      }

      // 4. Fetch all referenced product documents within transaction (all reads before writes)
      const productSnapshots = new Map();
      for (const productId of itemsByProduct.keys()) {
        const productRef = doc(db, 'products', productId);
        const productSnap = await transaction.get(productRef);
        if (!productSnap.exists()) {
          throw new Error(`Product with ID "${productId}" referenced in order #${orderId.slice(0, 8)} does not exist in store catalog.`);
        }
        productSnapshots.set(productId, { ref: productRef, data: productSnap.data() });
      }

      // 5. In-memory stock validation and deduction calculation
      const pendingProductUpdates = [];

      for (const [productId, productItems] of itemsByProduct.entries()) {
        const { ref: pRef, data: product } = productSnapshots.get(productId);
        const clonedProduct = JSON.parse(JSON.stringify(product));
        const variants = Array.isArray(clonedProduct.variants) ? clonedProduct.variants : [];

        for (const item of productItems) {
          const qty = parseInt(item.quantity, 10);
          if (isNaN(qty) || qty <= 0) {
            throw new Error(`Invalid quantity (${item.quantity}) for product "${product.name}".`);
          }

          if (variants.length > 0) {
            const v = variants.find(variant => 
              (item.variantId && (variant.variantId === item.variantId || variant.id === item.variantId)) ||
              (item.sku && variant.sku === item.sku) ||
              (item.size && variant.size === item.size)
            );

            if (!v) {
              throw new Error(`Variant "${item.size || item.variantId}" for product "${product.name}" was not found.`);
            }

            const currentStock = v.stock !== undefined ? parseInt(v.stock, 10) : 0;
            if (currentStock < qty) {
              throw new Error(
                `Insufficient stock for "${product.name} (${v.size})". Required: ${qty}, available: ${currentStock}. Order confirmation aborted.`
              );
            }

            v.stock = currentStock - qty;
          } else {
            const currentStock = product.stock !== undefined ? parseInt(product.stock, 10) : 0;
            if (currentStock < qty) {
              throw new Error(
                `Insufficient stock for "${product.name}". Required: ${qty}, available: ${currentStock}. Order confirmation aborted.`
              );
            }
            clonedProduct.stock = currentStock - qty;
          }
        }

        // Recalculate top-level stock from variants
        if (variants.length > 0) {
          clonedProduct.variants = variants;
          clonedProduct.stock = variants.reduce((sum, v) => sum + (parseInt(v.stock, 10) || 0), 0);
        }

        pendingProductUpdates.push({
          ref: pRef,
          productId: productId,
          productName: product.name,
          updatedVariants: clonedProduct.variants || [],
          updatedStock: clonedProduct.stock
        });
      }

      // 6. Apply all writes atomically
      for (const update of pendingProductUpdates) {
        transaction.update(update.ref, {
          variants: update.updatedVariants,
          stock: update.updatedStock,
          updatedAt: serverTimestamp()
        });
      }

      transaction.update(orderRef, {
        status: 'confirmed',
        inventoryDeducted: true,
        confirmedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      console.log(`[Firestore] Order #${orderId.slice(0, 8)} confirmed. Stock deducted across ${pendingProductUpdates.length} products.`);

      return {
        success: true,
        orderId: orderId,
        updatedProducts: pendingProductUpdates.map(u => ({ id: u.productId, name: u.productName, stock: u.updatedStock }))
      };
    });
  } catch (error) {
    console.error(`[Firestore] confirmOrder error for #${orderId.slice(0, 8)}:`, error.message);
    throw error;
  }
}


/**
 * Cancel an order and restore deducted inventory stock if previously confirmed.
 * 
 * INVENTORY RESTORATION GUARANTEES:
 * 1. If inventory was deducted (order.inventoryDeducted === true), atomically adds quantities back.
 * 2. If inventory was NOT deducted (e.g. order was in 'placed' status), cancels without modifying product stock.
 * 3. Double-cancellation safe: if already cancelled, rejects.
 * 4. Atomic transaction ensures order status and all product stock updates are committed together.
 * 
 * @param {string} orderId - Document ID in /orders
 * @returns {Promise<Object>} Result object { success: true, orderId, restored: boolean }
 */
export async function cancelOrder(orderId) {
  if (!db || !orderId) throw new Error('Order identifier is required.');

  const orderRef = doc(db, 'orders', orderId);

  try {
    return await runTransaction(db, async (transaction) => {
      const orderDoc = await transaction.get(orderRef);
      if (!orderDoc.exists()) {
        throw new Error(`Order #${orderId.slice(0, 8)} not found.`);
      }

      const orderData = orderDoc.data();

      if (orderData.status === 'cancelled') {
        throw new Error('This order is already cancelled.');
      }

      const items = Array.isArray(orderData.items) ? orderData.items : [];
      let wasRestored = false;

      // Only restore stock if it was actually deducted previously
      if (orderData.inventoryDeducted === true && items.length > 0) {
        const itemsByProduct = new Map();
        for (const item of items) {
          if (!item.productId) continue;
          if (!itemsByProduct.has(item.productId)) {
            itemsByProduct.set(item.productId, []);
          }
          itemsByProduct.get(item.productId).push(item);
        }

        const productSnapshots = new Map();
        for (const productId of itemsByProduct.keys()) {
          const productRef = doc(db, 'products', productId);
          const productSnap = await transaction.get(productRef);
          if (productSnap.exists()) {
            productSnapshots.set(productId, { ref: productRef, data: productSnap.data() });
          }
        }

        for (const [productId, productItems] of itemsByProduct.entries()) {
          const snap = productSnapshots.get(productId);
          if (!snap) continue;

          const { ref: pRef, data: product } = snap;
          const clonedProduct = JSON.parse(JSON.stringify(product));
          const variants = Array.isArray(clonedProduct.variants) ? clonedProduct.variants : [];

          for (const item of productItems) {
            const qty = parseInt(item.quantity, 10) || 0;
            if (qty <= 0) continue;

            if (variants.length > 0) {
              const v = variants.find(variant => 
                (item.variantId && (variant.variantId === item.variantId || variant.id === item.variantId)) ||
                (item.sku && variant.sku === item.sku) ||
                (item.size && variant.size === item.size)
              );
              if (v) {
                v.stock = (parseInt(v.stock, 10) || 0) + qty;
              }
            } else {
              clonedProduct.stock = (parseInt(product.stock, 10) || 0) + qty;
            }
          }

          if (variants.length > 0) {
            clonedProduct.variants = variants;
            clonedProduct.stock = variants.reduce((sum, v) => sum + (parseInt(v.stock, 10) || 0), 0);
          }

          transaction.update(pRef, {
            variants: clonedProduct.variants || [],
            stock: clonedProduct.stock,
            updatedAt: serverTimestamp()
          });
        }

        wasRestored = true;
      }

      transaction.update(orderRef, {
        status: 'cancelled',
        inventoryDeducted: false,
        cancelledAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      console.log(`[Firestore] Order #${orderId.slice(0, 8)} cancelled. Inventory restored: ${wasRestored}.`);

      return {
        success: true,
        orderId: orderId,
        restored: wasRestored
      };
    });
  } catch (error) {
    console.error(`[Firestore] cancelOrder error for #${orderId.slice(0, 8)}:`, error.message);
    throw error;
  }
}


/**
 * Transition order status.
 * Routes to atomic confirmOrder / cancelOrder workflows to guarantee inventory integrity.
 * 
 * @param {string} orderId
 * @param {'placed'|'confirmed'|'shipped'|'delivered'|'cancelled'} newStatus
 * @returns {Promise<boolean>}
 */
export async function updateOrderStatus(orderId, newStatus) {
  if (!db || !orderId) return false;

  if (newStatus === 'confirmed') {
    await confirmOrder(orderId);
    return true;
  }

  if (newStatus === 'cancelled') {
    await cancelOrder(orderId);
    return true;
  }

  // For shipped, delivered, or custom transitions:
  const orderRef = doc(db, 'orders', orderId);
  const snap = await getDoc(orderRef);
  if (!snap.exists()) {
    throw new Error(`Order #${orderId.slice(0, 8)} not found.`);
  }
  const orderData = snap.data();

  if (orderData.status === 'cancelled') {
    throw new Error(`Cannot transition a cancelled order to "${newStatus}".`);
  }

  // If transitioning directly to shipped or delivered from placed, deduct stock first
  if (orderData.inventoryDeducted !== true) {
    await confirmOrder(orderId);
  }

  await updateDoc(orderRef, {
    status: newStatus,
    updatedAt: serverTimestamp()
  });

  return true;
}


// ═══════════════════════════════════════════════
// STUBS FOR FUTURE PHASES
// ═══════════════════════════════════════════════

/**
 * Deterministically compare whether an existing Firestore order document matches
 * the incoming checkout payload across all critical checkout dimensions:
 * - User ID & Idempotency Key
 * - Subtotal, delivery charge, and grand total
 * - Customer contact name and phone number
 * - Delivery address lines, city, state, and postal PIN code
 * - Complete line-item composition (product IDs, variant IDs, quantities, and unit prices)
 * 
 * Line items are sorted by product and variant ID to ensure order-agnostic matching.
 * 
 * @param {Object} existing - Data from Firestore order document
 * @param {Object} incoming - Newly verified order payload
 * @returns {boolean} True if all checkout dimensions are strictly identical
 */
export function areOrderPayloadsIdentical(existing, incoming) {
  if (!existing || !incoming) return false;

  // 1. User and session identity
  if (String(existing.userId) !== String(incoming.userId)) return false;
  if (String(existing.idempotencyKey) !== String(incoming.idempotencyKey)) return false;

  // 2. Financial totals
  if (Number(existing.subtotal) !== Number(incoming.subtotal)) return false;
  if (Number(existing.deliveryCharge) !== Number(incoming.deliveryCharge)) return false;
  if (Number(existing.total) !== Number(incoming.total)) return false;

  // 3. Customer name & phone number
  const exName = (existing.customerName || '').trim().toLowerCase();
  const inName = (incoming.customerName || '').trim().toLowerCase();
  if (exName !== inName) return false;

  const exPhone = (existing.phone || '').replace(/\D/g, '');
  const inPhone = (incoming.phone || '').replace(/\D/g, '');
  if (exPhone !== inPhone) return false;

  // 4. Delivery Address
  const exAddr = existing.deliveryAddress || {};
  const inAddr = incoming.deliveryAddress || {};
  if ((exAddr.addressLine1 || '').trim().toLowerCase() !== (inAddr.addressLine1 || '').trim().toLowerCase()) return false;
  if ((exAddr.addressLine2 || '').trim().toLowerCase() !== (inAddr.addressLine2 || '').trim().toLowerCase()) return false;
  if ((exAddr.city || '').trim().toLowerCase() !== (inAddr.city || '').trim().toLowerCase()) return false;
  if ((exAddr.state || '').trim().toLowerCase() !== (inAddr.state || '').trim().toLowerCase()) return false;
  if ((exAddr.pincode || '').replace(/\D/g, '') !== (inAddr.pincode || '').replace(/\D/g, '')) return false;

  // 5. Line items (order-agnostic, checking product, variant, quantity, unitPrice, and lineTotal)
  const exItems = Array.isArray(existing.items) ? existing.items : [];
  const inItems = Array.isArray(incoming.items) ? incoming.items : [];
  if (exItems.length !== inItems.length) return false;

  const itemKey = (item) => `${String(item.productId)}__${String(item.variantId || 'default')}`;
  const sortedEx = [...exItems].sort((a, b) => itemKey(a).localeCompare(itemKey(b)));
  const sortedIn = [...inItems].sort((a, b) => itemKey(a).localeCompare(itemKey(b)));

  for (let idx = 0; idx < sortedEx.length; idx++) {
    const a = sortedEx[idx];
    const b = sortedIn[idx];
    if (String(a.productId) !== String(b.productId)) return false;
    if (String(a.variantId || 'default') !== String(b.variantId || 'default')) return false;
    if (Number(a.quantity) !== Number(b.quantity)) return false;
    if (Number(a.unitPrice) !== Number(b.unitPrice)) return false;
    if (Number(a.lineTotal) !== Number(b.lineTotal)) return false;
  }

  return true;
}


// ═══════════════════════════════════════════════
// ORDERS (Phase 4: Real Order Creation & History)
// ═══════════════════════════════════════════════

/**
 * Create a new customer order in Firestore.
 * 
 * SECURITY & INTEGRITY CHECKS:
 * 1. Requires authenticated user matching orderData.userId (enforced by Security Rules).
 * 2. Strict rejection of demonstration sample products. Real purchases must reference real products.
 * 3. Client re-verifies product prices and active statuses against Firestore live snapshots
 *    before calculating the subtotal and total, mitigating casual localStorage tampering.
 * 4. Architectural Note: Full production-level tamper protection against arbitrary client SDK calls
 *    requires a server-side Cloud Function to authoritatively sign prices and capture payments.
 * 5. Initial status is always 'placed' and paymentStatus is 'pending'.
 * 
 * @param {Object} orderData
 * @returns {Promise<Object>} The created order record with Firestore ID.
 */
export async function createOrder(orderData) {
  if (!db) throw new Error('Store database is not initialized. Please refresh and try again.');
  if (!orderData || !orderData.userId) {
    throw new Error('User authentication is required to place an order.');
  }

  const items = Array.isArray(orderData.items) ? orderData.items : [];
  if (items.length === 0) {
    throw new Error('Cannot create an order with an empty cart.');
  }
  if (items.length > 50) {
    throw new Error('Order exceeds the maximum limit of 50 items. Please reduce your cart size.');
  }

  // 1. Guard against demo sample products and malformed entries
  for (const item of items) {
    if (!item || !item.productId) {
      throw new Error('Malformed cart item detected. Please refresh your cart.');
    }
    if (String(item.productId).startsWith('demo-') || item.isSample === true) {
      throw new Error(
        `"${item.name || 'Sample item'}" is a demonstration sample product and cannot be purchased as a real order. Please add products from the live catalog.`
      );
    }
  }

  // 2. Validate customer contact & address fields
  const cleanName = (orderData.customerName || '').trim();
  if (cleanName.length < 2 || cleanName.length > 100) {
    throw new Error('Please enter a valid customer name (2 to 100 characters).');
  }

  const cleanPhone = (orderData.phone || '').replace(/\D/g, '');
  if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
    throw new Error('Please enter a valid 10-digit Indian mobile number starting with 6-9.');
  }

  const addr1 = (orderData.deliveryAddress?.addressLine1 || '').trim();
  if (addr1.length < 3) {
    throw new Error('Please provide a complete street address (minimum 3 characters).');
  }

  const city = (orderData.deliveryAddress?.city || 'Chennai').trim();
  if (city.length < 2) {
    throw new Error('Please provide a valid city name.');
  }

  const pincode = (orderData.deliveryAddress?.pincode || '').replace(/\D/g, '');
  if (!/^[1-9][0-9]{5}$/.test(pincode)) {
    throw new Error('Please enter a valid 6-digit Indian PIN code.');
  }

  const cleanIdempotencyKey = (orderData.idempotencyKey || '').trim();
  if (!cleanIdempotencyKey || !/^[a-zA-Z0-9_-]{10,100}$/.test(cleanIdempotencyKey)) {
    throw new Error('Invalid order session identifier. Please refresh your checkout page and try again.');
  }

  // 4. Server-verifiable snapshot re-check: prices, active status, and inventory boundaries
  let verifiedSubtotal = 0;
  const verifiedItems = [];

  for (const item of items) {
    const productDoc = await getProductById(item.productId);
    if (!productDoc) {
      throw new Error(`Product "${item.name || item.productId}" is no longer available in the store catalog.`);
    }
    if (!productDoc.isActive) {
      throw new Error(`Product "${productDoc.name}" has been deactivated and cannot be ordered.`);
    }

    // Validate integer quantity (must be >= 1 and <= 50)
    const rawQty = item.quantity;
    const qty = parseInt(rawQty, 10);
    if (isNaN(qty) || qty <= 0 || qty > 50 || String(rawQty).includes('.')) {
      throw new Error(`Invalid quantity (${rawQty}) for "${productDoc.name}". Quantity must be an integer between 1 and 50.`);
    }

    // Match variant by variantId or sku or size
    const variants = Array.isArray(productDoc.variants) && productDoc.variants.length > 0
      ? productDoc.variants
      : [{
          id: 'default',
          variantId: 'default',
          size: productDoc.unit || '1L',
          price: productDoc.price || 0,
          discountPrice: productDoc.discountPrice || null,
          stock: productDoc.stock || 0
        }];

    const matchedVariant = variants.find(v => 
      (item.variantId && (v.variantId === item.variantId || v.id === item.variantId)) ||
      (item.sku && v.sku === item.sku) ||
      (item.size && v.size === item.size)
    );

    if (!matchedVariant) {
      throw new Error(`The requested size/variant for "${productDoc.name}" does not exist in the store catalog.`);
    }

    // Stock boundary check: reject if requested quantity exceeds current inventory
    const availableStock = matchedVariant.stock !== undefined ? parseInt(matchedVariant.stock, 10) : 50;
    if (availableStock <= 0) {
      throw new Error(`"${productDoc.name} (${matchedVariant.size})" is currently out of stock.`);
    }
    if (qty > availableStock) {
      throw new Error(
        `Insufficient inventory for "${productDoc.name} (${matchedVariant.size})". Requested: ${qty}, available in shop: ${availableStock}.`
      );
    }

    // Determine authoritative unit price from database document
    const regularPrice = Math.max(0, Number(matchedVariant.price) || 0);
    const discountPrice = (matchedVariant.discountPrice && Number(matchedVariant.discountPrice) > 0 && Number(matchedVariant.discountPrice) < regularPrice)
      ? Number(matchedVariant.discountPrice)
      : null;
    const unitPrice = discountPrice !== null ? discountPrice : regularPrice;

    const lineTotal = unitPrice * qty;
    verifiedSubtotal += lineTotal;

    verifiedItems.push({
      productId: item.productId,
      variantId: matchedVariant.variantId || matchedVariant.id || matchedVariant.size,
      sku: matchedVariant.sku || '',
      size: matchedVariant.size || '1L',
      name: productDoc.name,
      nameTamil: productDoc.nameTamil || '',
      unitPrice: unitPrice,
      originalPrice: regularPrice,
      quantity: qty,
      lineTotal: lineTotal,
      imageURL: productDoc.imageURL || (Array.isArray(productDoc.imageURLs) && productDoc.imageURLs[0]) || ''
    });
  }

  // 5. Compute delivery charge & grand total based strictly on verified subtotal
  const deliveryCharge = verifiedSubtotal >= 999 ? 0 : 40;
  const verifiedTotal = verifiedSubtotal + deliveryCharge;

  const orderPayload = {
    userId: orderData.userId,
    userEmail: orderData.userEmail || '',
    customerName: cleanName,
    phone: cleanPhone,
    deliveryAddress: {
      addressLine1: addr1,
      addressLine2: (orderData.deliveryAddress?.addressLine2 || '').trim(),
      city: city,
      state: 'Tamil Nadu',
      pincode: pincode
    },
    items: verifiedItems,
    subtotal: verifiedSubtotal,
    deliveryCharge: deliveryCharge,
    total: verifiedTotal,
    notes: (orderData.notes || '').slice(0, 500).trim(),
    status: 'placed',               // Customer cannot set any status other than 'placed'
    paymentStatus: 'pending',        // Customer cannot set any paymentStatus other than 'pending'
    paymentMethod: orderData.paymentMethod === 'enquiry' ? 'enquiry' : 'cash_on_delivery',
    idempotencyKey: cleanIdempotencyKey,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  // 6. Deterministic Document ID & Atomic Creation / Retrieval via runTransaction
  // Uses cleanIdempotencyKey as the exact document ID in /orders/{orderId}
  const orderRef = doc(db, 'orders', cleanIdempotencyKey);

  try {
    const orderRecord = await runTransaction(db, async (transaction) => {
      const orderDoc = await transaction.get(orderRef);
      if (orderDoc.exists()) {
        const existingData = orderDoc.data();
        // 1. Strictly verify that the existing order belongs to the requesting user
        // to prevent cross-user session collisions or data leakage
        if (existingData.userId !== orderData.userId) {
          throw new Error('An order session conflict occurred. Please refresh your checkout page.');
        }

        // 2. Deterministically verify that incoming payload strictly matches the existing order
        // across items, quantities, prices, totals, and delivery contact info
        if (areOrderPayloadsIdentical(existingData, orderPayload)) {
          console.log('[Firestore] Legitimate network retry detected; returning existing order record.');
          return { id: orderDoc.id, ...existingData, isRetry: true };
        }

        // 3. Payload mismatch detected for this idempotency key
        throw new Error('Order submission conflict: An order already exists for this session key with different cart or delivery details. Please refresh your checkout page.');
      }

      // Order does not exist: write it atomically
      transaction.set(orderRef, orderPayload);
      return { id: cleanIdempotencyKey, ...orderPayload };
    });

    console.log('[Firestore] Order processed with ID:', orderRecord.id);
    return orderRecord;
  } catch (error) {
    console.error('[Firestore] createOrder error:', error);
    if (error.code === 'permission-denied') {
      throw new Error('Permission denied: You must be signed in with a verified account to place an order.');
    }
    if (error.code === 'unavailable') {
      throw new Error('Service temporarily unavailable. Please check your internet connection.');
    }
    throw new Error(error.message || 'Unable to place order. Please review your details and try again.');
  }
}

/**
 * Fetch orders for a specific user ID.
 * 
 * @param {string} userId
 * @returns {Promise<Array<Object>>}
 */
export async function getUserOrders(userId) {
  if (!db || !userId) return [];

  try {
    const ordersRef = collection(db, 'orders');
    const q = query(
      ordersRef,
      where('userId', '==', userId),
      orderBy('createdAt', 'desc'),
      limit(50)
    );
    const snap = await getDocs(q);
    const orders = [];
    snap.forEach(d => orders.push({ id: d.id, ...d.data() }));
    return orders;
  } catch (error) {
    // If compound index is building or not available, query without orderBy
    try {
      const fallbackQuery = query(collection(db, 'orders'), where('userId', '==', userId));
      const snap = await getDocs(fallbackQuery);
      const orders = [];
      snap.forEach(d => orders.push({ id: d.id, ...d.data() }));
      return orders.sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return timeB - timeA;
      });
    } catch (fallbackErr) {
      console.warn('[Firestore] getUserOrders error:', fallbackErr.message);
      return [];
    }
  }
}

/**
 * Fetch customer reviews for a specific product.
 * Returns reviews sorted by creation date descending, limited to 20.
 * Automatically falls back to in-memory sorting if composite index is pending.
 * 
 * @param {string} productId - Firestore or catalog product identifier
 * @returns {Promise<Array<Object>>} List of review records with IDs
 */
export async function getProductReviews(productId) {
  if (!db || !productId) return [];

  const cleanId = String(productId).trim();
  if (!cleanId) return [];

  const reviewsRef = collection(db, 'reviews');

  try {
    // Primary query: filtered by productId, sorted by createdAt desc, limited to 20
    const q = query(
      reviewsRef,
      where('productId', '==', cleanId),
      orderBy('createdAt', 'desc'),
      limit(20)
    );
    const snap = await getDocs(q);
    const reviews = [];
    snap.forEach(d => {
      reviews.push({ id: d.id, ...d.data() });
    });
    return reviews;
  } catch (error) {
    // Check if error is due to compound index requirement (FAILED_PRECONDITION)
    console.warn('[Firestore] getProductReviews ordered query note:', error.message);
    try {
      // Fallback query without orderBy, sorted in-memory by createdAt desc
      const fallbackQuery = query(
        reviewsRef,
        where('productId', '==', cleanId)
      );
      const snap = await getDocs(fallbackQuery);
      const reviews = [];
      snap.forEach(d => {
        reviews.push({ id: d.id, ...d.data() });
      });
      return reviews.sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt instanceof Date ? a.createdAt.getTime() : 0);
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt instanceof Date ? b.createdAt.getTime() : 0);
        return timeB - timeA;
      }).slice(0, 20);
    } catch (fallbackErr) {
      console.error('[Firestore] getProductReviews fallback error:', fallbackErr.message);
      throw fallbackErr;
    }
  }
}

/**
 * Submit a new customer review to Firestore.
 * Strictly enforces schema constraints required by Firestore Security Rules:
 * - userId: derived from authenticated Firebase user
 * - userName: string (display name or fallback)
 * - productId: string
 * - rating: integer 1..5
 * - comment: string <= 1000 chars
 * - createdAt: serverTimestamp()
 * 
 * @param {Object} reviewData - { productId, rating, comment, userName? }
 * @returns {Promise<Object>} Created review document record with ID
 */
export async function createReview(reviewData) {
  if (!db) throw new Error('Database is not initialized.');

  // Require authenticated Firebase user; derive userId from verified auth state
  const currentUser = auth?.currentUser;
  if (!currentUser || !currentUser.uid) {
    throw new Error('You must be signed in with Google to post a review.');
  }

  if (!reviewData || typeof reviewData !== 'object') {
    throw new Error('Invalid review submission data.');
  }

  const productId = String(reviewData.productId || '').trim();
  if (!productId || !/^[a-zA-Z0-9_-]{1,64}$/.test(productId)) {
    throw new Error('A valid product identifier is required to post a review.');
  }

  // Integer rating from 1 to 5
  const rawRating = reviewData.rating;
  const rating = Number(rawRating);
  if (isNaN(rating) || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error('Rating must be an integer between 1 and 5 stars.');
  }

  // Comment: non-empty, trimmed, maximum 1000 characters
  const comment = String(reviewData.comment || '').trim();
  if (!comment) {
    throw new Error('Please write a comment for your review.');
  }
  if (comment.length > 1000) {
    throw new Error('Review comment cannot exceed 1,000 characters.');
  }

  const userName = (currentUser.displayName || reviewData.userName || 'Customer').trim().slice(0, 100);

  // Exactly matching firestore.rules keys().hasOnly constraint
  const payload = {
    userId: currentUser.uid,
    userName: userName || 'Customer',
    productId: productId,
    rating: rating,
    comment: comment,
    createdAt: serverTimestamp()
  };

  try {
    const reviewsRef = collection(db, 'reviews');
    const docRef = await addDoc(reviewsRef, payload);
    return {
      id: docRef.id,
      ...payload
    };
  } catch (error) {
    console.error('[Firestore] createReview error:', error);
    if (error.code === 'permission-denied') {
      throw new Error('Permission denied: You must be signed in to submit a review.');
    }
    throw new Error(error.message || 'Unable to submit your review. Please try again.');
  }
}
