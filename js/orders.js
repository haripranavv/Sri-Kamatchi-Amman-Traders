/**
 * orders.js — Customer Order History Controller
 * Sri Kamatchi Amman Traders — E-Commerce Storefront
 *
 * Requirements:
 * - Strictly fetches orders for the authenticated user (auth.currentUser.uid).
 * - Never trusts or reads client-supplied user IDs from query params or form inputs.
 * - Handles loading, unauthenticated, empty, error, and populated order states.
 * - Fully sanitizes all customer-supplied fields against XSS.
 * - Responsive layout matching the storefront design system.
 */

import { getUserOrders } from './firestore.js';
import {
  initAuthObserver,
  onAuthChange,
  signInWithGoogle,
  signOut,
  getCurrentUser,
  getCurrentUserProfile
} from './auth.js';
import { initCartUI } from './cart-ui.js';
import {
  formatPrice,
  formatDate,
  sanitizeHTML,
  showToast,
  $
} from './utils.js';
import { STORE_CONFIG } from './config.js';

// DOM Elements — Navbar Auth
const signInBtn         = $('#nav-sign-in-btn');
const userMenuContainer = $('#user-menu-container');
const userMenuTrigger   = $('#user-menu-trigger');
const userMenuDropdown  = $('#user-menu-dropdown');
const userAvatar        = $('#user-avatar');
const userName          = $('#user-name');
const userEmail         = $('#user-email');
const roleBadge         = $('#user-role-badge');
const adminLink         = $('#user-menu-admin-link');
const signOutBtn        = $('#sign-out-btn');

// DOM Elements — Page States
const loadingStateEl    = $('#orders-loading-state');
const unauthStateEl     = $('#orders-unauth-state');
const emptyStateEl      = $('#orders-empty-state');
const errorStateEl      = $('#orders-error-state');
const errorMessageEl    = $('#orders-error-message');
const ordersListEl      = $('#orders-list-container');
const btnGoogleLogin    = $('#btn-orders-google-login');
const btnRetry          = $('#btn-orders-retry');

// Local Auth State
let currentUser = null;
let currentProfile = null;

/**
 * Switch visible state card / view.
 * @param {'loading'|'unauth'|'empty'|'error'|'list'} state
 */
function showOrdersState(state) {
  loadingStateEl?.classList.toggle('hidden', state !== 'loading');
  unauthStateEl?.classList.toggle('hidden', state !== 'unauth');
  emptyStateEl?.classList.toggle('hidden', state !== 'empty');
  errorStateEl?.classList.toggle('hidden', state !== 'error');
  ordersListEl?.classList.toggle('hidden', state !== 'list');
}

/**
 * Load and render order history for the currently authenticated user.
 * Strictly derives the user UID from Firebase Auth.
 */
async function loadCustomerOrders() {
  if (!currentUser || !currentUser.uid) {
    showOrdersState('unauth');
    return;
  }

  showOrdersState('loading');

  try {
    // Strictly fetch using authenticated user's UID (no query param or client override)
    const orders = await getUserOrders(currentUser.uid);

    if (!Array.isArray(orders) || orders.length === 0) {
      showOrdersState('empty');
      return;
    }

    renderOrdersList(orders);
    showOrdersState('list');
  } catch (err) {
    console.error('[Orders] Failed to load order history:', err);
    if (errorMessageEl) {
      errorMessageEl.textContent = err.message || 'Unable to retrieve your order history. Please try again.';
    }
    showOrdersState('error');
  }
}

/**
 * Render customer order cards into the list container.
 * All dynamic customer fields are safely escaped.
 * @param {Array<Object>} orders
 */
function renderOrdersList(orders) {
  if (!ordersListEl) return;

  ordersListEl.innerHTML = orders.map(ord => {
    // Format creation date & time
    let formattedDate = 'Recent';
    if (ord.createdAt) {
      if (typeof ord.createdAt.toDate === 'function') {
        formattedDate = ord.createdAt.toDate().toLocaleString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      } else {
        formattedDate = formatDate(ord.createdAt);
      }
    }

    // Status pill
    const rawStatus = (ord.status || 'placed').toLowerCase();
    const statusLabels = {
      placed: 'Order Placed',
      confirmed: 'Confirmed',
      shipped: 'Shipped',
      delivered: 'Delivered',
      cancelled: 'Cancelled'
    };
    const statusLabel = statusLabels[rawStatus] || rawStatus;
    const pillClass = `order-status-pill order-status-pill--${rawStatus}`;

    // Delivery address
    const addr = ord.deliveryAddress || {};
    const recipientName = ord.customerName || ord.userName || currentUser.displayName || 'Customer';
    const addressLines = [
      addr.addressLine1,
      addr.addressLine2,
      addr.city,
      addr.state ? `${addr.state}${addr.pincode ? ` - ${addr.pincode}` : ''}` : addr.pincode
    ].filter(Boolean);
    const formattedAddress = addressLines.map(sanitizeHTML).join(', ');

    // Ordered line items
    const items = Array.isArray(ord.items) ? ord.items : [];
    const itemsHTML = items.map(item => {
      const itemName = sanitizeHTML(item.name || 'Traditional Cooking Oil');
      const itemSize = sanitizeHTML(item.size || (item.variantId ? '1L' : 'Standard'));
      const unitPrice = Number(item.unitPrice) || 0;
      const qty = parseInt(item.quantity, 10) || 1;
      const lineTotal = Number(item.lineTotal) || (unitPrice * qty);
      const imgUrl = item.imageURL ? sanitizeHTML(item.imageURL) : STORE_CONFIG.placeholderImage;

      return `
        <div class="order-item-row">
          <div class="order-item-row__info">
            <img class="order-item-row__img" src="${imgUrl}" alt="${itemName}" width="52" height="52" loading="lazy" onerror="this.src='${STORE_CONFIG.placeholderImage}'" />
            <div class="order-item-row__details">
              <span class="order-item-row__name">${itemName}</span>
              <span class="order-item-row__sub">${itemSize} • Qty: ${qty} × ${formatPrice(unitPrice)}</span>
            </div>
          </div>
          <div class="order-item-row__price">
            ${formatPrice(lineTotal)}
          </div>
        </div>
      `;
    }).join('');

    // Financial totals
    const subtotal = Number(ord.subtotal) || 0;
    const deliveryCharge = Number(ord.deliveryCharge) || 0;
    const grandTotal = Number(ord.total) || (subtotal + deliveryCharge);
    const paymentMethod = (ord.paymentMethod || 'cash_on_delivery').replace(/_/g, ' ');
    const paymentStatus = ord.paymentStatus || 'Pending on Delivery';

    return `
      <article class="order-card" data-order-id="${sanitizeHTML(ord.id)}">
        <header class="order-card__header">
          <div class="order-card__meta">
            <span class="order-card__number">Order #${sanitizeHTML(ord.id.slice(0, 8).toUpperCase())}</span>
            <time class="order-card__date">${sanitizeHTML(formattedDate)}</time>
          </div>
          <div>
            <span class="${pillClass}">${sanitizeHTML(statusLabel)}</span>
          </div>
        </header>

        <div class="order-card__body">
          <div class="order-items-list">
            ${itemsHTML || '<p class="text-xs text-muted">No line item details recorded.</p>'}
          </div>

          <div class="order-info-grid">
            <div class="order-info-block">
              <div class="order-info-block__label">Delivery Address</div>
              <div class="order-info-block__content">
                <strong>${sanitizeHTML(recipientName)}</strong><br />
                ${ord.phone ? `Phone: ${sanitizeHTML(ord.phone)}<br />` : ''}
                ${formattedAddress || 'Address on file'}
              </div>
            </div>

            <div class="order-info-block">
              <div class="order-info-block__label">Payment & Delivery</div>
              <div class="order-info-block__content">
                <span style="text-transform: capitalize;">${sanitizeHTML(paymentMethod)}</span><br />
                <span class="text-xs text-muted">Status: ${sanitizeHTML(paymentStatus)}</span>
                ${ord.notes ? `<div class="text-xs text-muted" style="margin-top: 4px;"><em>Note: ${sanitizeHTML(ord.notes)}</em></div>` : ''}
              </div>
            </div>
          </div>
        </div>

        <footer class="order-card__footer">
          <div class="order-breakdown">
            <span>Items: ${formatPrice(subtotal)}</span>
            <span>•</span>
            <span>Delivery: ${deliveryCharge === 0 ? 'FREE' : formatPrice(deliveryCharge)}</span>
          </div>
          <div class="order-total-badge">
            <span class="order-total-badge__label">Order Total:</span>
            <span class="order-total-badge__amount">${formatPrice(grandTotal)}</span>
          </div>
        </footer>
      </article>
    `;
  }).join('');
}

/**
 * Handle reactive authentication state updates.
 * @param {Object|null} user
 * @param {Object|null} profile
 */
function syncAuthState(user, profile) {
  currentUser = user;
  currentProfile = profile;

  if (user) {
    // Show user avatar & menu in navbar
    signInBtn?.classList.add('hidden');
    userMenuContainer?.classList.remove('hidden');

    if (userAvatar) {
      userAvatar.src = user.photoURL || '';
      userAvatar.alt = user.displayName || 'Customer';
    }
    if (userName) userName.textContent = profile?.displayName || user.displayName || 'Customer';
    if (userEmail) userEmail.textContent = user.email || '';

    if (profile?.role === 'admin') {
      roleBadge?.classList.remove('hidden');
      if (roleBadge) roleBadge.textContent = 'Admin';
      adminLink?.classList.remove('hidden');
    } else {
      roleBadge?.classList.add('hidden');
      adminLink?.classList.add('hidden');
    }

    // Load authenticated orders
    loadCustomerOrders();
  } else {
    // Show sign-in button, hide user menu
    signInBtn?.classList.remove('hidden');
    userMenuContainer?.classList.add('hidden');
    userMenuDropdown?.classList.remove('is-open');

    // Show unauthenticated prompt on page
    showOrdersState('unauth');
  }
}

/**
 * Setup UI event listeners.
 */
function setupEventListeners() {
  // Sign in actions
  const triggerSignIn = async () => {
    try {
      await signInWithGoogle();
      showToast('Signed in successfully!', 'success');
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        showToast(err.message || 'Sign in failed.', 'error');
      }
    }
  };

  btnGoogleLogin?.addEventListener('click', triggerSignIn);
  signInBtn?.addEventListener('click', triggerSignIn);

  // Sign out action
  signOutBtn?.addEventListener('click', async () => {
    try {
      await signOut();
      showToast('Signed out successfully.', 'info');
    } catch (err) {
      showToast('Failed to sign out.', 'error');
    }
  });

  // Retry action
  btnRetry?.addEventListener('click', () => {
    loadCustomerOrders();
  });

  // User menu dropdown toggle
  userMenuTrigger?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = userMenuDropdown?.classList.toggle('is-open');
    userMenuTrigger.setAttribute('aria-expanded', String(isOpen));
  });

  document.addEventListener('click', (e) => {
    if (userMenuDropdown && !userMenuDropdown.contains(e.target) && !userMenuTrigger?.contains(e.target)) {
      userMenuDropdown.classList.remove('is-open');
      userMenuTrigger?.setAttribute('aria-expanded', 'false');
    }
  });
}

/**
 * Page initialization bootstrap.
 */
function initOrdersPage() {
  // Initialize shared shopping cart drawer
  initCartUI();

  // Setup click & keyboard events
  setupEventListeners();

  // Initialize auth observer and register reactive listener
  initAuthObserver();
  onAuthChange(syncAuthState);
}

// Bootstrap on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initOrdersPage);
} else {
  initOrdersPage();
}

