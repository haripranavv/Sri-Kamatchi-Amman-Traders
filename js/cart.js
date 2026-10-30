/**
 * cart.js — Shopping Cart Management Module
 * 
 * Manages client-side shopping cart state with:
 * - Deterministic item keying: `${productId}__${variantId}`
 * - Automatic merging of matching product variants
 * - Quantity update and stock boundary checks
 * - Safe persistence in localStorage (`skat_cart_v1`)
 * - Live event broadcast via 'skat:cart-updated' for reactive UI sync
 * - Clear segregation and warning flags for demonstration sample products
 */

import { STORE_CONFIG } from './config.js';

const STORAGE_KEY = 'skat_cart_v1';

/**
 * Generate a deterministic composite key for a product variant.
 * 
 * @param {string} productId
 * @param {string} variantId
 * @returns {string}
 */
export function getCartItemKey(productId, variantId) {
  const pId = String(productId || '').trim();
  const vId = String(variantId || 'default').trim();
  return `${pId}__${vId}`;
}

/**
 * Load cart items from localStorage.
 * Handles parsing errors gracefully, validates entries, and discards corrupt data.
 * 
 * @returns {Array<Object>}
 */
export function getCart() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    // Validate and sanitize every cart item to guard against corruption or malformed entries
    const validItems = parsed.filter(item => {
      if (!item || typeof item !== 'object') return false;
      if (!item.key || typeof item.key !== 'string') return false;
      const qty = parseInt(item.quantity, 10);
      if (isNaN(qty) || qty <= 0) return false;
      const price = Number(item.unitPrice !== undefined ? item.unitPrice : item.price);
      if (isNaN(price) || price < 0) return false;
      return true;
    }).map(item => {
      const pId = String(item.productId || (typeof item.key === 'string' ? item.key.split('__')[0] : '') || 'product');
      return {
        ...item,
        productId: pId,
        quantity: parseInt(item.quantity, 10),
        unitPrice: Number(item.unitPrice !== undefined ? item.unitPrice : item.price),
        price: Number(item.price !== undefined ? item.price : item.unitPrice),
        stock: (item.stock !== undefined && !isNaN(parseInt(item.stock, 10))) ? parseInt(item.stock, 10) : 0,
        isSample: Boolean(item.isSample || pId.startsWith('demo-'))
      };
    });

    return validItems;
  } catch (error) {
    console.warn('[Cart] Failed to read cart from localStorage, initializing empty:', error);
    return [];
  }
}

/**
 * Alias for getCart() to preserve architecture plan naming.
 * @returns {Array<Object>}
 */
export function getCartItems() {
  return getCart();
}

/**
 * Persist cart items to localStorage and emit 'skat:cart-updated' event.
 * 
 * @param {Array<Object>} items
 */
function saveCart(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (error) {
    console.error('[Cart] Failed to save cart to localStorage:', error);
  }

  // Calculate summary metrics for the broadcast event
  const count = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const subtotal = items.reduce((sum, item) => sum + ((Number(item.unitPrice) || 0) * (Number(item.quantity) || 0)), 0);
  const deliveryCharge = items.length === 0 ? 0 : (subtotal >= STORE_CONFIG.freeDeliveryThreshold ? 0 : STORE_CONFIG.deliveryFee);
  const total = subtotal + deliveryCharge;
  const hasSample = items.some(i => i.isSample === true || String(i.productId).startsWith('demo-'));

  const detail = {
    items,
    count,
    subtotal,
    deliveryCharge,
    total,
    hasSample
  };

  window.dispatchEvent(new CustomEvent('skat:cart-updated', { detail }));
}

/**
 * Add a product variant to the cart.
 * If the variant already exists in the cart, its quantity is incremented.
 * 
 * @param {Object} product - Product record (Firestore or demo catalog)
 * @param {Object|null} [variant] - Specific variant. If null, default variant is selected.
 * @param {number} [quantity=1] - Quantity to add
 * @returns {{ success: boolean, item?: Object, message?: string }}
 */
export function addToCart(product, variant = null, quantity = 1) {
  if (!product || !product.id) {
    console.error('[Cart] addToCart rejected: invalid product payload.');
    return { success: false, message: 'Invalid product.' };
  }

  const addQty = Math.max(1, parseInt(quantity, 10) || 1);

  // 1. Resolve variant
  let selectedVariant = variant;
  if (!selectedVariant) {
    if (Array.isArray(product.variants) && product.variants.length > 0) {
      selectedVariant = product.variants.find(v => v.isDefault) || product.variants[0];
    } else {
      selectedVariant = {
        id: 'default',
        variantId: 'default',
        size: product.unit || '1L',
        sku: `${(product.category || 'OIL').toUpperCase().slice(0, 3)}-1L`,
        price: Number(product.price) || 0,
        discountPrice: product.discountPrice ? Number(product.discountPrice) : null,
        stock: product.stock !== undefined ? Number(product.stock) : 50
      };
    }
  }

  const variantId = selectedVariant.variantId || selectedVariant.id || selectedVariant.sku || selectedVariant.size || 'default';
  const itemKey = getCartItemKey(product.id, variantId);

  // Determine effective unit price (discountPrice if active, else price)
  const regularPrice = Number(selectedVariant.price) || Number(product.price) || 0;
  const discountPrice = (selectedVariant.discountPrice && Number(selectedVariant.discountPrice) > 0 && Number(selectedVariant.discountPrice) < regularPrice)
    ? Number(selectedVariant.discountPrice)
    : null;
  const unitPrice = discountPrice !== null ? discountPrice : regularPrice;

  // Stock check: Authoritative stock must be a valid integer > 0; missing/invalid stock is never treated as unlimited
  const rawStock = selectedVariant.stock !== undefined
    ? parseInt(selectedVariant.stock, 10)
    : (product.stock !== undefined ? parseInt(product.stock, 10) : NaN);
  const availableStock = isNaN(rawStock) ? 0 : rawStock;

  if (availableStock <= 0) {
    return {
      success: false,
      message: `"${product.name || 'Product'}" (${selectedVariant.size || '1L'}) is currently out of stock.`
    };
  }

  const currentCart = getCart();
  const existingIndex = currentCart.findIndex(item => item.key === itemKey);

  let targetItem;

  if (existingIndex > -1) {
    // Merge existing item
    const existing = currentCart[existingIndex];
    if (existing.quantity >= availableStock) {
      return {
        success: false,
        item: existing,
        message: `Cannot add more. Maximum available stock (${availableStock}) already in your cart.`
      };
    }

    const newQty = existing.quantity + addQty;

    if (newQty > availableStock) {
      existing.quantity = availableStock;
      existing.stock = availableStock;
      saveCart(currentCart);
      return {
        success: true,
        item: existing,
        message: `Quantity adjusted to maximum available stock (${availableStock}).`
      };
    }

    existing.quantity = newQty;
    existing.stock = availableStock;
    targetItem = existing;
  } else {
    // New cart item: strictly bounded by available stock
    const initialQty = Math.min(addQty, availableStock);
    const isSample = Boolean(product.isSample || String(product.id).startsWith('demo-'));

    targetItem = {
      key: itemKey,
      productId: product.id,
      variantId: variantId,
      name: product.name || 'Cooking Oil',
      nameTamil: product.nameTamil || '',
      category: product.category || 'sesame',
      size: selectedVariant.size || product.unit || '1L',
      sku: selectedVariant.sku || '',
      price: regularPrice,
      discountPrice: discountPrice,
      unitPrice: unitPrice,
      quantity: initialQty,
      stock: availableStock,
      imageURL: product.imageURL || (Array.isArray(product.imageURLs) && product.imageURLs[0]) || STORE_CONFIG.placeholderImage,
      isSample: isSample
    };

    currentCart.push(targetItem);
  }

  saveCart(currentCart);
  return { success: true, item: targetItem };
}

/**
 * Update the quantity of a cart item by its unique key.
 * If newQuantity <= 0 or item is out of stock, the item is removed.
 * Enforces authoritative stock upper bound.
 * 
 * @param {string} itemKey - Composite key (`${productId}__${variantId}`)
 * @param {number} newQuantity
 * @returns {boolean}
 */
export function updateQuantity(itemKey, newQuantity) {
  const qty = parseInt(newQuantity, 10);
  const currentCart = getCart();
  const index = currentCart.findIndex(item => item.key === itemKey);

  if (index === -1) return false;

  if (isNaN(qty) || qty <= 0) {
    return removeFromCart(itemKey);
  }

  const item = currentCart[index];
  const maxStock = (item.stock !== undefined && !isNaN(parseInt(item.stock, 10))) ? parseInt(item.stock, 10) : 0;

  if (maxStock <= 0) {
    return removeFromCart(itemKey);
  }

  if (qty > maxStock) {
    item.quantity = maxStock;
  } else {
    item.quantity = qty;
  }

  saveCart(currentCart);
  return true;
}

/**
 * Remove an item from the cart by its key.
 * 
 * @param {string} itemKey - Composite key (`${productId}__${variantId}`)
 * @returns {boolean}
 */
export function removeFromCart(itemKey) {
  const currentCart = getCart();
  const updated = currentCart.filter(item => item.key !== itemKey);

  if (updated.length !== currentCart.length) {
    saveCart(updated);
    return true;
  }
  return false;
}

/**
 * Clear all items from the cart.
 */
export function clearCart() {
  saveCart([]);
}

/**
 * Return total quantity of items in the cart.
 * @returns {number}
 */
export function getCartCount() {
  const items = getCart();
  return items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
}

/**
 * Return the raw items subtotal before delivery charges.
 * @returns {number}
 */
export function getCartSubtotal() {
  const items = getCart();
  return items.reduce((sum, item) => sum + ((Number(item.unitPrice) || 0) * (Number(item.quantity) || 0)), 0);
}

/**
 * Calculate applicable delivery fee based on store free delivery threshold.
 * @returns {number}
 */
export function getDeliveryCharge(subtotal = null) {
  const sub = subtotal !== null ? subtotal : getCartSubtotal();
  if (sub <= 0) return 0;
  return sub >= STORE_CONFIG.freeDeliveryThreshold ? 0 : STORE_CONFIG.deliveryFee;
}

/**
 * Return grand total (subtotal + delivery fee).
 * @returns {number}
 */
export function getCartTotal() {
  const sub = getCartSubtotal();
  if (sub <= 0) return 0;
  return sub + getDeliveryCharge(sub);
}

/**
 * Check whether any items in the cart are demonstration samples.
 * @returns {boolean}
 */
export function hasSampleItems() {
  return getCart().some(i => i && (i.isSample === true || String(i.productId || '').startsWith('demo-')));
}

/**
 * Register a listener for cart changes.
 * Immediately invokes the callback with current state if immediate=true.
 * 
 * @param {Function} callback
 * @param {boolean} [immediate=false]
 * @returns {Function} Unsubscribe function
 */
export function onCartChange(callback, immediate = false) {
  const handler = (e) => {
    callback(e.detail || {
      items: getCart(),
      count: getCartCount(),
      subtotal: getCartSubtotal(),
      deliveryCharge: getDeliveryCharge(),
      total: getCartTotal(),
      hasSample: hasSampleItems()
    });
  };

  window.addEventListener('skat:cart-updated', handler);

  if (immediate) {
    const items = getCart();
    const subtotal = getCartSubtotal();
    const deliveryCharge = getDeliveryCharge(subtotal);
    callback({
      items,
      count: getCartCount(),
      subtotal,
      deliveryCharge,
      total: subtotal + deliveryCharge,
      hasSample: hasSampleItems()
    });
  }

  return () => window.removeEventListener('skat:cart-updated', handler);
}
