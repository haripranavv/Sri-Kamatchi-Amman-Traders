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

import { db } from './firebase-config.js';

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
  limit
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

  // Clean and sanitize each variant
  let hasDefault = false;
  variants = variants.map((v, index) => {
    const isDefault = v.isDefault === true || (!hasDefault && index === 0);
    if (isDefault) hasDefault = true;

    return {
      size: (v.size || '1L').trim(),
      sku: (v.sku || '').trim().toUpperCase(),
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
 * Update the status of an existing order.
 * Restricted to administrators.
 * 
 * @param {string} orderId
 * @param {string} status - 'placed' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled'
 * @returns {Promise<boolean>}
 */
export async function updateOrderStatus(orderId, status) {
  if (!db || !orderId) return false;

  try {
    const orderRef = doc(db, 'orders', orderId);
    await updateDoc(orderRef, {
      status: status,
      updatedAt: serverTimestamp()
    });
    return true;
  } catch (error) {
    console.error('[Firestore] updateOrderStatus error:', error);
    throw error;
  }
}


// ═══════════════════════════════════════════════
// STUBS FOR FUTURE PHASES
// ═══════════════════════════════════════════════

export async function createOrder(/* orderData */) {
  console.warn('[Firestore] createOrder() is part of Phase 4: Commerce.');
  return null;
}

export async function getUserOrders(/* userId */) {
  console.warn('[Firestore] getUserOrders() is part of Phase 4: Commerce.');
  return [];
}

export async function getProductReviews(/* productId */) {
  return [];
}

export async function createReview(/* reviewData */) {
  return null;
}
