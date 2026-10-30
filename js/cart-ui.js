/**
 * cart-ui.js — Reusable Shopping Cart UI & Drawer Controller
 * 
 * Provides:
 * - Dynamic cart drawer injection into any page
 * - Navbar cart button and live item count badge
 * - Real-time UI synchronization with cart state
 * - WhatsApp order formatting (disabled gracefully when phone is unconfigured)
 * - Safe transition to checkout
 */

import {
  getCart,
  getCartCount,
  getCartSubtotal,
  getDeliveryCharge,
  getCartTotal,
  updateQuantity,
  removeFromCart,
  hasSampleItems,
  onCartChange
} from './cart.js';
import { formatPrice, sanitizeHTML } from './utils.js';
import { STORE_CONFIG, isWhatsAppConfigured, buildWhatsAppLink } from './config.js';

let drawerElement = null;
let backdropElement = null;

/**
 * Validates that an image URL begins with an allowed safe protocol or asset path.
 * @param {string} url
 * @returns {boolean}
 */
function isSafeImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim().toLowerCase();
  return trimmed.startsWith('assets/') || trimmed.startsWith('https://') || trimmed.startsWith('http://');
}

/**
 * Build the full WhatsApp order enquiry message text from current cart items.
 * 
 * @param {Array<Object>} items
 * @param {number} subtotal
 * @param {number} deliveryCharge
 * @param {number} total
 * @returns {string}
 */
export function formatCartWhatsAppMessage(items, subtotal, deliveryCharge, total) {
  const lineItems = items.map((item, idx) => {
    return `${idx + 1}. ${item.name} (${item.size}) × ${item.quantity} = ${formatPrice(item.unitPrice * item.quantity)}`;
  }).join('\n');

  return `வணக்கம் / Hello ${STORE_CONFIG.storeName},
I would like to place an order for the following cooking oils:

${lineItems}

-------------------------
Subtotal: ${formatPrice(subtotal)}
Delivery: ${deliveryCharge === 0 ? 'FREE' : formatPrice(deliveryCharge)}
Estimated Total: ${formatPrice(total)}

Please confirm stock availability and delivery timeline to my address. Thank you!`;
}

/**
 * Initialize Cart UI on the active page:
 * 1. Attaches event listeners to navbar cart triggers.
 * 2. Injects the Cart Drawer into the DOM.
 * 3. Subscribes to cart change events for live UI updates.
 */
export function initCartUI() {
  ensureDrawerDOM();
  updateNavbarBadge();

  // Listen for cart state changes
  onCartChange(() => {
    updateNavbarBadge();
    if (isDrawerOpen()) {
      renderDrawerContents();
    }
  });

  // Attach click listener to any navbar cart buttons
  document.querySelectorAll('[data-action="open-cart"], #nav-cart-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      openCartDrawer();
    });
  });

  // Keyboard shortcut: Esc closes drawer
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isDrawerOpen()) {
      closeCartDrawer();
    }
  });
}

/**
 * Update the navbar cart badge counter.
 */
export function updateNavbarBadge() {
  const count = getCartCount();
  document.querySelectorAll('.navbar__cart-badge, #nav-cart-badge').forEach(badge => {
    badge.textContent = count;
    badge.classList.toggle('is-zero', count === 0);
    badge.setAttribute('aria-label', `${count} items in shopping cart`);
  });
}

/**
 * Check if the drawer is currently open.
 * @returns {boolean}
 */
export function isDrawerOpen() {
  return backdropElement?.classList.contains('is-open') || false;
}

/**
 * Open the shopping cart drawer and re-render contents.
 */
export function openCartDrawer() {
  ensureDrawerDOM();
  renderDrawerContents();
  backdropElement?.classList.add('is-open');
  document.body.style.overflow = 'hidden';
}

/**
 * Close the shopping cart drawer.
 */
export function closeCartDrawer() {
  backdropElement?.classList.remove('is-open');
  document.body.style.overflow = '';
}

/**
 * Ensure the cart drawer HTML elements are present in the document body.
 */
function ensureDrawerDOM() {
  if (backdropElement && document.body.contains(backdropElement)) return;

  backdropElement = document.createElement('div');
  backdropElement.className = 'cart-drawer-backdrop';
  backdropElement.setAttribute('role', 'dialog');
  backdropElement.setAttribute('aria-modal', 'true');
  backdropElement.setAttribute('aria-label', 'Shopping Cart');

  backdropElement.innerHTML = `
    <div class="cart-drawer" id="cart-drawer-panel">
      <div class="cart-drawer__header">
        <h2 class="cart-drawer__title">
          <span>🛒</span> Shopping Cart
        </h2>
        <button class="cart-drawer__close" id="cart-drawer-close-btn" aria-label="Close cart">✕</button>
      </div>

      <div id="cart-drawer-sample-alert" class="cart-drawer__sample-alert hidden">
        ⚠️ <strong>Notice:</strong> Your cart includes sample demonstration products. Demo items cannot be submitted as real orders.
      </div>

      <div class="cart-drawer__body" id="cart-drawer-items">
        <!-- Rendered dynamically -->
      </div>

      <div class="cart-drawer__footer" id="cart-drawer-footer">
        <!-- Rendered dynamically -->
      </div>
    </div>
  `;

  document.body.appendChild(backdropElement);
  drawerElement = backdropElement.querySelector('.cart-drawer');

  // Backdrop click closes drawer
  backdropElement.addEventListener('click', (e) => {
    if (e.target === backdropElement) {
      closeCartDrawer();
    }
  });

  // Close button click
  backdropElement.querySelector('#cart-drawer-close-btn')?.addEventListener('click', () => {
    closeCartDrawer();
  });
}

/**
 * Render the items and summary inside the cart drawer.
 */
function renderDrawerContents() {
  if (!backdropElement) return;

  const items = getCart();
  const bodyEl = backdropElement.querySelector('#cart-drawer-items');
  const footerEl = backdropElement.querySelector('#cart-drawer-footer');
  const sampleAlert = backdropElement.querySelector('#cart-drawer-sample-alert');

  if (!bodyEl || !footerEl) return;

  // Toggle sample alert
  sampleAlert?.classList.toggle('hidden', !hasSampleItems());

  // Empty state
  if (items.length === 0) {
    bodyEl.innerHTML = `
      <div class="cart-drawer__empty">
        <div class="cart-drawer__empty-icon">🛢️</div>
        <p class="cart-drawer__empty-text">Your cart is currently empty. Explore our authentic cold-pressed oils!</p>
        <button class="btn btn--secondary btn--sm" id="cart-drawer-continue-btn">
          Explore Products
        </button>
      </div>
    `;
    footerEl.innerHTML = '';

    bodyEl.querySelector('#cart-drawer-continue-btn')?.addEventListener('click', () => {
      closeCartDrawer();
      const productsSection = document.getElementById('products-section');
      if (productsSection) {
        productsSection.scrollIntoView({ behavior: 'smooth' });
      }
    });
    return;
  }

  // Render items list
  bodyEl.innerHTML = items.map(item => {
    const isSampleBadge = item.isSample
      ? '<span class="cart-item__sample-badge">Sample Demo</span>'
      : '';

    const fallbackImg = STORE_CONFIG.placeholderImage;
    const imgUrl = isSafeImageUrl(item.imageURL) ? item.imageURL : fallbackImg;
    const safeKey = sanitizeHTML(item.key || '');

    return `
      <div class="cart-item" data-cart-key="${safeKey}">
        <div class="cart-item__image-wrap">
          <img src="${sanitizeHTML(imgUrl)}" alt="${sanitizeHTML(item.name)}" width="64" height="64" loading="lazy" class="cart-item__image" onerror="this.onerror=null; this.src='${fallbackImg}';" />
        </div>
        <div class="cart-item__info">
          <h4 class="cart-item__name">${sanitizeHTML(item.name)}</h4>
          <div class="cart-item__meta">
            <span class="cart-item__size-badge">${sanitizeHTML(item.size)}</span>
            ${isSampleBadge}
          </div>
          <div class="cart-item__pricing">
            <span>${formatPrice(item.unitPrice)} each</span>
          </div>
        </div>
        <div class="cart-item__actions">
          <button class="cart-item__remove-btn" data-action="remove-item" data-key="${safeKey}" title="Remove item">✕</button>
          <div class="qty-stepper">
            <button class="qty-stepper__btn" data-action="decrease-qty" data-key="${safeKey}">−</button>
            <span class="qty-stepper__val">${item.quantity}</span>
            <button class="qty-stepper__btn" data-action="increase-qty" data-key="${safeKey}" ${item.stock > 0 && item.quantity >= item.stock ? 'disabled' : ''}>+</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Attach item action listeners
  bodyEl.querySelectorAll('[data-action="remove-item"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-key');
      removeFromCart(key);
    });
  });

  bodyEl.querySelectorAll('[data-action="decrease-qty"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-key');
      const item = items.find(i => i.key === key);
      if (item) {
        updateQuantity(key, item.quantity - 1);
      }
    });
  });

  bodyEl.querySelectorAll('[data-action="increase-qty"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-key');
      const item = items.find(i => i.key === key);
      if (item) {
        updateQuantity(key, item.quantity + 1);
      }
    });
  });

  // Render Footer Summary & Actions
  const subtotal = getCartSubtotal();
  const deliveryCharge = getDeliveryCharge(subtotal);
  const total = getCartTotal();
  const isWaActive = isWhatsAppConfigured();
  const waLink = isWaActive ? buildWhatsAppLink(formatCartWhatsAppMessage(items, subtotal, deliveryCharge, total)) : null;

  footerEl.innerHTML = `
    <div class="cart-drawer__summary-row">
      <span>Subtotal</span>
      <span class="font-semibold">${formatPrice(subtotal)}</span>
    </div>
    <div class="cart-drawer__summary-row">
      <span>Delivery</span>
      <span>${deliveryCharge === 0 ? '<span style="color:var(--color-success); font-weight:600;">FREE</span>' : formatPrice(deliveryCharge)}</span>
    </div>
    ${subtotal < STORE_CONFIG.freeDeliveryThreshold ? `
      <div class="cart-drawer__delivery-note">
        Add ${formatPrice(STORE_CONFIG.freeDeliveryThreshold - subtotal)} more for free delivery!
      </div>
    ` : `
      <div class="cart-drawer__delivery-note" style="color:var(--color-success);">
        ✓ Free delivery unlocked on this order!
      </div>
    `}
    <div class="cart-drawer__summary-row cart-drawer__summary-row--total">
      <span>Estimated Total</span>
      <span style="color:var(--color-deep-olive); font-size:var(--text-lg);">${formatPrice(total)}</span>
    </div>

    <div class="cart-drawer__actions">
      <a href="checkout.html" class="btn btn--primary" style="width:100%; text-align:center;">
        Proceed to Checkout →
      </a>
      ${isWaActive ? `
        <a href="${waLink}" target="_blank" rel="noopener noreferrer" class="btn btn--whatsapp" style="width:100%; text-align:center;">
          💬 Order via WhatsApp
        </a>
      ` : `
        <button class="btn btn--whatsapp" disabled title="WhatsApp ordering is temporarily unconfigured by the store owner." style="width:100%;">
          💬 WhatsApp Order (Not Configured)
        </button>
      `}
    </div>
  `;
}

