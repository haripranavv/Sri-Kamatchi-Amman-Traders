/**
 * checkout.js — Checkout Page Controller
 * 
 * Manages:
 * - Live cart synchronization & order summary
 * - Google Authentication check (enforcing Firestore order ownership)
 * - Strict Indian phone and PIN code validation
 * - Prevention of demo/sample product submissions
 * - Idempotent, duplicate-safe order creation in Firestore
 * - WhatsApp ordering fallback for unauthenticated users
 * - Order confirmation display & cart clearing
 */

import { getCart, getCartSubtotal, getDeliveryCharge, getCartTotal, hasSampleItems, clearCart, onCartChange } from './cart.js';
import { createOrder } from './firestore.js';
import { initAuthObserver, onAuthChange, signInWithGoogle, signOut, getCurrentUser, getCurrentUserProfile } from './auth.js';
import { initCartUI } from './cart-ui.js';
import { formatPrice, sanitizeHTML, showToast, $ } from './utils.js';
import { STORE_CONFIG, isWhatsAppConfigured, buildWhatsAppLink } from './config.js';

// DOM References
const authBannerEl          = $('#checkout-auth-banner');
const authStatusTextEl      = $('#checkout-auth-status-text');
const btnGoogleLogin        = $('#checkout-btn-google-login');

// Form Inputs
const checkoutForm          = $('#checkout-form');
const inputName             = $('#checkout-name');
const inputPhone            = $('#checkout-phone');
const inputEmail            = $('#checkout-email');
const inputAddress1         = $('#checkout-address1');
const inputAddress2         = $('#checkout-address2');
const inputCity             = $('#checkout-city');
const inputState            = $('#checkout-state');
const inputPincode          = $('#checkout-pincode');
const inputNotes            = $('#checkout-notes');

// Error Hints
const errName               = $('#err-name');
const errPhone              = $('#err-phone');
const errAddress1           = $('#err-address1');
const errCity               = $('#err-city');
const errPincode            = $('#err-pincode');

// Summary & Actions
const itemsListEl           = $('#checkout-items-list');
const subtotalEl            = $('#checkout-subtotal');
const deliveryEl            = $('#checkout-delivery');
const grandTotalEl          = $('#checkout-grand-total');
const sampleWarningEl       = $('#checkout-sample-warning');
const emptyWarningEl        = $('#checkout-empty-warning');
const btnSubmitOrder        = $('#btn-submit-order');
const btnCheckoutWhatsApp   = $('#btn-checkout-whatsapp');

// Success Confirmation View
const mainGridEl            = $('#checkout-main-grid');
const successViewEl         = $('#checkout-success-view');
const successOrderIdEl      = $('#success-order-id');
const successCustomerNameEl = $('#success-customer-name');
const successPhoneEl        = $('#success-phone');
const successAddressEl      = $('#success-address');
const successTotalEl        = $('#success-total');
const successBtnWhatsApp    = $('#success-btn-whatsapp');

// State
let currentUser = null;
let currentProfile = null;
let isSubmitting = false;
let currentCheckoutIdempotencyKey = null;

/**
 * Obtain or generate a stable idempotency key for this checkout session.
 * Reused on retries for the same cart attempt; invalidated when the cart changes or on order success.
 * Conforms strictly to Firestore document ID constraints (/^[a-zA-Z0-9_-]{10,100}$/).
 */
function getOrCreateIdempotencyKey() {
  if (!currentCheckoutIdempotencyKey && currentUser) {
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const timeCode = Date.now().toString(36);
    currentCheckoutIdempotencyKey = `ord_${currentUser.uid.slice(0, 8)}_${timeCode}_${randomSuffix}`;
  }
  return currentCheckoutIdempotencyKey;
}

function invalidateIdempotencyKey() {
  currentCheckoutIdempotencyKey = null;
}

/**
 * Initialize checkout page.
 */
function initCheckoutPage() {
  initCartUI();
  setupAuthNavbar();
  renderSummary();

  // Re-render summary whenever cart changes & invalidate key to reflect new cart composition
  onCartChange(() => {
    invalidateIdempotencyKey();
    renderSummary();
  });

  // Wire submission
  btnSubmitOrder?.addEventListener('click', handleOrderSubmission);

  // Wire WhatsApp checkout button (for users without Google login)
  setupWhatsAppCheckout();

  // Clear field errors on input & invalidate idempotency key when checkout details change
  const onFieldChange = (inputEl, errEl) => {
    clearFieldError(inputEl, errEl);
    invalidateIdempotencyKey();
  };
  inputName?.addEventListener('input', () => onFieldChange(inputName, errName));
  inputPhone?.addEventListener('input', () => onFieldChange(inputPhone, errPhone));
  inputAddress1?.addEventListener('input', () => onFieldChange(inputAddress1, errAddress1));
  inputAddress2?.addEventListener('input', () => invalidateIdempotencyKey());
  inputCity?.addEventListener('input', () => onFieldChange(inputCity, errCity));
  inputPincode?.addEventListener('input', () => onFieldChange(inputPincode, errPincode));
  inputNotes?.addEventListener('input', () => invalidateIdempotencyKey());
}

/**
 * Render the order summary column.
 */
function renderSummary() {
  const items = getCart();
  const subtotal = getCartSubtotal();
  const delivery = getDeliveryCharge(subtotal);
  const total = getCartTotal();
  const hasSample = hasSampleItems();

  // Empty Cart Check
  if (items.length === 0) {
    emptyWarningEl?.classList.remove('hidden');
    itemsListEl.innerHTML = '';
    subtotalEl.textContent = '₹0';
    deliveryEl.textContent = '₹0';
    grandTotalEl.textContent = '₹0';
    if (btnSubmitOrder) {
      btnSubmitOrder.disabled = true;
      btnSubmitOrder.textContent = 'Cart is Empty';
    }
    return;
  }

  emptyWarningEl?.classList.add('hidden');

  // Sample Items Warning
  sampleWarningEl?.classList.toggle('hidden', !hasSample);

  // Render items list
  itemsListEl.innerHTML = items.map(item => `
    <div class="checkout-item">
      <img src="${sanitizeHTML(item.imageURL || STORE_CONFIG.placeholderImage)}" alt="${sanitizeHTML(item.name)}" width="52" height="52" loading="lazy" class="checkout-item__thumb" onerror="this.onerror=null; this.src='${STORE_CONFIG.placeholderImage}';" />
      <div class="checkout-item__details">
        <h4 class="checkout-item__title">${sanitizeHTML(item.name)}</h4>
        <p class="checkout-item__meta">${sanitizeHTML(item.size)} × ${item.quantity}</p>
        ${item.isSample ? '<span style="font-size:10px; color:#92400e; background:#fef3c7; padding:1px 4px; border-radius:3px;">Sample Item</span>' : ''}
      </div>
      <div class="checkout-item__total">
        ${formatPrice(item.unitPrice * item.quantity)}
      </div>
    </div>
  `).join('');

  // Update totals
  if (subtotalEl) subtotalEl.textContent = formatPrice(subtotal);
  if (deliveryEl) deliveryEl.textContent = delivery === 0 ? 'FREE' : formatPrice(delivery);
  if (grandTotalEl) grandTotalEl.textContent = formatPrice(total);

  // Update Submit Button State
  updateSubmitButtonState(items, hasSample, total);
}

/**
 * Determine submit button enabled/disabled status.
 */
function updateSubmitButtonState(items, hasSample, total) {
  if (!btnSubmitOrder) return;

  if (items.length === 0) {
    btnSubmitOrder.disabled = true;
    btnSubmitOrder.textContent = 'Cart is Empty';
    return;
  }

  if (hasSample) {
    btnSubmitOrder.disabled = true;
    btnSubmitOrder.textContent = 'Remove Sample Items to Order';
    return;
  }

  if (!currentUser) {
    btnSubmitOrder.disabled = true;
    btnSubmitOrder.textContent = 'Sign in with Google to Place Order';
    return;
  }

  if (isSubmitting) {
    btnSubmitOrder.disabled = true;
    btnSubmitOrder.textContent = 'Verifying & Placing Order...';
    return;
  }

  btnSubmitOrder.disabled = false;
  btnSubmitOrder.textContent = `Confirm & Place Order (${formatPrice(total)})`;
}

/**
 * Configure WhatsApp Order button.
 */
function setupWhatsAppCheckout() {
  if (!btnCheckoutWhatsApp) return;

  const isConfigured = isWhatsAppConfigured();
  if (!isConfigured) {
    btnCheckoutWhatsApp.classList.add('hidden');
    return;
  }

  btnCheckoutWhatsApp.classList.remove('hidden');

  btnCheckoutWhatsApp.addEventListener('click', () => {
    const items = getCart();
    if (items.length === 0) {
      showToast('Your cart is empty.', 'warning');
      return;
    }

    const name = (inputName?.value || '').trim() || 'Customer';
    const phone = (inputPhone?.value || '').trim() || 'N/A';
    const address = [inputAddress1?.value, inputAddress2?.value, inputCity?.value, inputPincode?.value].filter(Boolean).join(', ');
    const subtotal = getCartSubtotal();
    const delivery = getDeliveryCharge(subtotal);
    const total = getCartTotal();

    const lineItems = items.map((item, idx) => {
      return `${idx + 1}. ${item.name} (${item.size}) × ${item.quantity} = ${formatPrice(item.unitPrice * item.quantity)}`;
    }).join('\n');

    const message = `வணக்கம் / Hello ${STORE_CONFIG.storeName},
I would like to place an order via WhatsApp:

Customer: ${name}
Phone: ${phone}
Delivery Address: ${address || 'Will provide in chat'}

Items:
${lineItems}

-------------------------
Subtotal: ${formatPrice(subtotal)}
Delivery: ${delivery === 0 ? 'FREE' : formatPrice(delivery)}
Total: ${formatPrice(total)}

Please confirm order acceptance. Thank you!`;

    const url = buildWhatsAppLink(message);
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  });
}

/**
 * Clear validation error on an input field.
 */
function clearFieldError(inputEl, errEl) {
  inputEl?.classList.remove('is-invalid');
  errEl?.classList.add('hidden');
}

/**
 * Validate customer address fields.
 * @returns {boolean} True if all valid
 */
function validateForm() {
  let isValid = true;

  // Name: at least 2 characters
  const nameVal = (inputName?.value || '').trim();
  if (nameVal.length < 2) {
    inputName?.classList.add('is-invalid');
    errName?.classList.remove('hidden');
    isValid = false;
  } else {
    clearFieldError(inputName, errName);
  }

  // Indian Phone: exactly 10 digits starting with 6-9
  const phoneVal = (inputPhone?.value || '').replace(/\D/g, '');
  const phonePattern = /^[6-9]\d{9}$/;
  if (!phonePattern.test(phoneVal)) {
    inputPhone?.classList.add('is-invalid');
    errPhone?.classList.remove('hidden');
    isValid = false;
  } else {
    clearFieldError(inputPhone, errPhone);
  }

  // Address Line 1: at least 5 characters
  const address1Val = (inputAddress1?.value || '').trim();
  if (address1Val.length < 5) {
    inputAddress1?.classList.add('is-invalid');
    errAddress1?.classList.remove('hidden');
    isValid = false;
  } else {
    clearFieldError(inputAddress1, errAddress1);
  }

  // City: at least 2 characters
  const cityVal = (inputCity?.value || '').trim();
  if (cityVal.length < 2) {
    inputCity?.classList.add('is-invalid');
    errCity?.classList.remove('hidden');
    isValid = false;
  } else {
    clearFieldError(inputCity, errCity);
  }

  // Indian PIN Code: exactly 6 digits
  const pincodeVal = (inputPincode?.value || '').replace(/\D/g, '');
  const pincodePattern = /^[1-9][0-9]{5}$/;
  if (!pincodePattern.test(pincodeVal)) {
    inputPincode?.classList.add('is-invalid');
    errPincode?.classList.remove('hidden');
    isValid = false;
  } else {
    clearFieldError(inputPincode, errPincode);
  }

  return isValid;
}

/**
 * Handle order creation.
 */
async function handleOrderSubmission() {
  if (isSubmitting) return;

  // 1. Guard Authentication
  if (!currentUser) {
    showToast('Please sign in with Google to place your order.', 'warning');
    try {
      await signInWithGoogle();
    } catch (err) {
      console.warn('Sign in cancelled or failed:', err);
    }
    return;
  }

  // 2. Guard Cart State & Demo Items
  const items = getCart();
  if (items.length === 0) {
    showToast('Cannot place an order with an empty cart.', 'warning');
    return;
  }

  if (hasSampleItems()) {
    showToast('Please remove demonstration sample items from your cart to proceed with a real purchase.', 'error');
    return;
  }

  // 3. Validate Form
  if (!validateForm()) {
    showToast('Please complete all required delivery fields.', 'warning');
    return;
  }

  // 4. Set Loading State & Prevent Duplicate Submissions
  isSubmitting = true;
  updateSubmitButtonState(items, false, getCartTotal());

  // Obtain stable idempotency key for this checkout attempt (reused on retry)
  const idempotencyKey = getOrCreateIdempotencyKey();
  if (!idempotencyKey) {
    isSubmitting = false;
    showToast('Please sign in with Google to place your order.', 'warning');
    return;
  }

  try {
    const orderData = {
      userId: currentUser.uid,
      userEmail: currentUser.email || inputEmail?.value || '',
      customerName: (inputName?.value || '').trim(),
      phone: (inputPhone?.value || '').replace(/\D/g, ''),
      deliveryAddress: {
        addressLine1: (inputAddress1?.value || '').trim(),
        addressLine2: (inputAddress2?.value || '').trim(),
        city: (inputCity?.value || 'Chennai').trim(),
        state: 'Tamil Nadu',
        pincode: (inputPincode?.value || '').replace(/\D/g, '')
      },
      items: items,
      notes: (inputNotes?.value || '').trim(),
      paymentMethod: 'cash_on_delivery',
      idempotencyKey: idempotencyKey
    };

    // Call Firestore createOrder (which performs atomic transaction check/create)
    const createdOrder = await createOrder(orderData);

    // 5. Success: Clear cart, invalidate key, & render confirmation view
    clearCart();
    invalidateIdempotencyKey();
    showOrderSuccess(createdOrder);
    showToast('Order placed successfully!', 'success');
  } catch (error) {
    console.error('[Checkout] Order placement error:', error.message);
    if (error.message && (error.message.includes('conflict') || error.message.includes('already exists'))) {
      invalidateIdempotencyKey();
    }
    const sanitizedMsg = error.message.includes('permission-denied')
      ? 'Permission denied. Please ensure you are logged in.'
      : (error.message || 'Failed to place order. Please check your connection.');
    showToast(sanitizedMsg, 'error');
  } finally {
    isSubmitting = false;
    updateSubmitButtonState(getCart(), hasSampleItems(), getCartTotal());
  }
}

/**
 * Display the order success confirmation view.
 * @param {Object} order
 */
function showOrderSuccess(order) {
  mainGridEl?.classList.add('hidden');
  successViewEl?.classList.remove('hidden');

  if (successOrderIdEl) successOrderIdEl.textContent = `Order #${order.id.slice(0, 8).toUpperCase()}`;
  if (successCustomerNameEl) successCustomerNameEl.textContent = order.customerName || 'Customer';
  if (successPhoneEl) successPhoneEl.textContent = order.phone || '';

  const fullAddress = [
    order.deliveryAddress?.addressLine1,
    order.deliveryAddress?.addressLine2,
    order.deliveryAddress?.city,
    order.deliveryAddress?.state,
    order.deliveryAddress?.pincode
  ].filter(Boolean).join(', ');

  if (successAddressEl) successAddressEl.textContent = fullAddress;
  if (successTotalEl) successTotalEl.textContent = formatPrice(order.total || 0);

  // WhatsApp confirmation share if configured
  if (isWhatsAppConfigured() && successBtnWhatsApp) {
    successBtnWhatsApp.classList.remove('hidden');
    successBtnWhatsApp.onclick = () => {
      const msg = `வணக்கம் / Hello ${STORE_CONFIG.storeName},
I have just placed Order #${order.id.slice(0, 8).toUpperCase()} on your website:
- Total: ${formatPrice(order.total)}
- Name: ${order.customerName}
- Phone: ${order.phone}
Please confirm dispatch timeline. Thank you!`;
      const url = buildWhatsAppLink(msg);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    };
  } else {
    successBtnWhatsApp?.classList.add('hidden');
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Synchronize navbar and checkout authentication state.
 */
function setupAuthNavbar() {
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

  const handleSignIn = async () => {
    try {
      await signInWithGoogle();
    } catch (err) {
      showToast(err.message || 'Sign in failed.', 'error');
    }
  };

  signInBtn?.addEventListener('click', handleSignIn);
  btnGoogleLogin?.addEventListener('click', handleSignIn);

  userMenuTrigger?.addEventListener('click', (e) => {
    e.stopPropagation();
    userMenuDropdown?.classList.toggle('is-open');
  });

  document.addEventListener('click', () => {
    userMenuDropdown?.classList.remove('is-open');
  });

  signOutBtn?.addEventListener('click', async () => {
    await signOut();
    userMenuDropdown?.classList.remove('is-open');
  });

  const syncAuthState = (user, profile) => {
    currentUser = user;
    currentProfile = profile;
    invalidateIdempotencyKey();

    if (user) {
      // Navbar updates
      signInBtn?.classList.add('hidden');
      userMenuContainer?.classList.remove('hidden');

      if (userAvatar) userAvatar.src = user.photoURL || '';
      if (userName) userName.textContent = sanitizeHTML(profile?.displayName || user.displayName || 'Customer');
      if (userEmail) userEmail.textContent = sanitizeHTML(user.email || '');

      if (profile?.role === 'admin') {
        roleBadge?.classList.remove('hidden');
        if (roleBadge) roleBadge.textContent = 'Admin';
        adminLink?.classList.remove('hidden');
      } else {
        roleBadge?.classList.add('hidden');
        adminLink?.classList.add('hidden');
      }

      // Checkout Auth Banner updates
      if (authStatusTextEl) {
        authStatusTextEl.innerHTML = `Signed in as <strong>${sanitizeHTML(user.displayName || user.email)}</strong>. Your order will be safely linked to this account.`;
      }
      btnGoogleLogin?.classList.add('hidden');

      // Pre-fill form fields
      if (inputName && !inputName.value) inputName.value = profile?.displayName || user.displayName || '';
      if (inputEmail && !inputEmail.value) inputEmail.value = user.email || '';
      if (inputPhone && !inputPhone.value && profile?.phone) inputPhone.value = profile.phone;
    } else {
      signInBtn?.classList.remove('hidden');
      userMenuContainer?.classList.add('hidden');
      adminLink?.classList.add('hidden');

      if (authStatusTextEl) {
        authStatusTextEl.textContent = 'Please sign in with Google to create an order document under your verified account.';
      }
      btnGoogleLogin?.classList.remove('hidden');
    }

    renderSummary();
  };

  // Start auth observer once, and register persistent listener for reactive updates
  initAuthObserver();
  onAuthChange(syncAuthState);
}

// Bootstrap
document.addEventListener('DOMContentLoaded', initCheckoutPage);

