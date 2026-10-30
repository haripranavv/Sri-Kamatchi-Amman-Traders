/**
 * product.js — Product Detail Page Controller
 * 
 * Handles:
 * - URL parameter parsing (`?id=<productId>`)
 * - Fetching verified product from Firestore with fallback to demo catalog
 * - Dynamic variant selection & live pricing updates
 * - Quantity stepper with inventory stock boundary validation
 * - Cart integration with instant feedback
 * - WhatsApp enquiry generation (disabled when phone is unconfigured)
 * - Firebase Auth navbar synchronization
 */

import { getProductById } from './firestore.js';
import { SAMPLE_PRODUCTS } from './home.js';
import { addToCart } from './cart.js';
import { initCartUI, openCartDrawer } from './cart-ui.js';
import { initAuthObserver, signInWithGoogle, signOut } from './auth.js';
import { formatPrice, sanitizeHTML, showToast, $ } from './utils.js';
import { STORE_CONFIG, isWhatsAppConfigured, buildWhatsAppLink } from './config.js';

// DOM References
const loadingEl           = $('#product-loading');
const errorEl             = $('#product-error');
const errorMsgEl          = $('#product-error-msg');
const contentEl           = $('#product-content');
const breadcrumbNameEl    = $('#breadcrumb-product-name');

// Gallery
const mainImageEl         = $('#product-main-image');
const badgesContainer     = $('#product-badges-container');
const thumbsContainer     = $('#product-thumbs-container');

// Info & Pricing
const categoryTextEl      = $('#product-category-text');
const titleTextEl         = $('#product-title-text');
const titleTamilEl        = $('#product-title-tamil');
const starsEl             = $('#product-stars');
const ratingTextEl        = $('#product-rating-text');
const displayPriceEl      = $('#product-display-price');
const originalPriceEl     = $('#product-original-price');
const discountBadgeEl     = $('#product-discount-badge');
const skuEl               = $('#product-sku');
const demoAlertEl         = $('#product-demo-alert');
const stockStatusEl       = $('#product-stock-status');
const descriptionEl       = $('#product-description');

// Nutrition
const nutritionCaloriesEl = $('#nutrition-calories');
const nutritionFatEl      = $('#nutrition-fat');
const nutritionSatFatEl   = $('#nutrition-sat-fat');

// Variant & Quantity Stepper
const variantContainer    = $('#variant-pills-container');
const qtyValEl            = $('#product-qty-val');
const btnQtyMinus         = $('#btn-qty-minus');
const btnQtyPlus          = $('#btn-qty-plus');
const btnAddToCart        = $('#btn-add-to-cart');
const btnWhatsApp         = $('#btn-whatsapp-enquire');

// State
let currentProduct = null;
let selectedVariant = null;
let currentQuantity = 1;

/**
 * Initialize the product details page.
 */
async function initProductPage() {
  initCartUI();
  setupAuthNavbar();

  // Extract ?id= from URL query
  const urlParams = new URLSearchParams(window.location.search);
  const productId = urlParams.get('id');

  if (!productId) {
    showError('No product identifier was provided. Please choose a product from the storefront.');
    return;
  }

  try {
    // 1. Attempt to fetch verified product from Firestore
    let product = await getProductById(productId);

    // 2. If not found in Firestore, check demonstration sample products
    if (!product) {
      product = SAMPLE_PRODUCTS.find(p => p.id === productId);
    }

    if (!product) {
      showError(`The product "${sanitizeHTML(productId)}" could not be found in our store catalog.`);
      return;
    }

    currentProduct = product;
    renderProductDetails(product);
  } catch (err) {
    console.error('[ProductPage] Error loading product:', err);
    // Check fallback sample catalog if network/permissions block Firestore
    const sample = SAMPLE_PRODUCTS.find(p => p.id === productId);
    if (sample) {
      currentProduct = sample;
      renderProductDetails(sample);
    } else {
      showError('Unable to load product information right now. Please try again later.');
    }
  }
}

/**
 * Display error state.
 * @param {string} message
 */
function showError(message) {
  loadingEl?.classList.add('hidden');
  contentEl?.classList.add('hidden');
  errorEl?.classList.remove('hidden');
  if (errorMsgEl) errorMsgEl.textContent = message;
  if (breadcrumbNameEl) breadcrumbNameEl.textContent = 'Not Found';
}

/**
 * Render all product details onto the page.
 * @param {Object} product
 */
function renderProductDetails(product) {
  loadingEl?.classList.add('hidden');
  errorEl?.classList.add('hidden');
  contentEl?.classList.remove('hidden');

  // Breadcrumb & Page title
  document.title = `${product.name} — ${STORE_CONFIG.storeName}`;
  if (breadcrumbNameEl) breadcrumbNameEl.textContent = product.name;

  // Header info
  if (categoryTextEl) categoryTextEl.textContent = product.category || 'Traditional Oil';
  if (titleTextEl) titleTextEl.textContent = product.name;
  if (titleTamilEl) {
    titleTamilEl.textContent = product.nameTamil || '';
    titleTamilEl.classList.toggle('hidden', !product.nameTamil);
  }

  // Star ratings
  const rating = Number(product.rating) || 5;
  const reviewCount = Number(product.reviewCount) || 12;
  const fullStars = Math.floor(rating);
  const halfStar = rating % 1 >= 0.5 ? '½' : '';
  const emptyStars = Math.max(0, 5 - fullStars - (halfStar ? 1 : 0));
  if (starsEl) starsEl.textContent = '★'.repeat(fullStars) + halfStar + '☆'.repeat(emptyStars);
  if (ratingTextEl) ratingTextEl.textContent = `${rating} (${reviewCount} customer reviews)`;

  // Demo warning
  const isSample = Boolean(product.isSample || String(product.id).startsWith('demo-'));
  demoAlertEl?.classList.toggle('hidden', !isSample);

  // Gallery
  renderGallery(product);

  // Description & Nutrition
  if (descriptionEl) {
    descriptionEl.textContent = product.description || 
      `100% pure cold-pressed ${product.name}. Prepared by Sri Kamatchi Amman Traders adhering to centuries-old Tamil Nadu traditions. Unheated and unrefined to preserve vital natural nutrients.`;
  }
  if (nutritionCaloriesEl) nutritionCaloriesEl.textContent = product.nutritionInfo?.calories || '884 kcal / 100ml';
  if (nutritionFatEl) nutritionFatEl.textContent = product.nutritionInfo?.fat || '100g';
  if (nutritionSatFatEl) nutritionSatFatEl.textContent = product.nutritionInfo?.saturatedFat || '14g';

  // Normalize variants list
  let variants = Array.isArray(product.variants) && product.variants.length > 0
    ? product.variants
    : [{
        id: 'default',
        variantId: 'default',
        size: product.unit || '1L',
        sku: `${(product.category || 'OIL').toUpperCase().slice(0, 3)}-1L`,
        price: Number(product.price) || 0,
        discountPrice: product.discountPrice ? Number(product.discountPrice) : null,
        stock: product.stock !== undefined ? Number(product.stock) : 50,
        isDefault: true
      }];

  // Initial variant selection: default variant or first
  selectedVariant = variants.find(v => v.isDefault) || variants[0];
  currentQuantity = 1;

  // Render variant pills
  renderVariants(variants);

  // Update prices & stock for selected variant
  updateVariantDisplay();

  // Wire buttons
  wireActionButtons();
}

/**
 * Render product image gallery and badges.
 */
function renderGallery(product) {
  const fallbackImg = STORE_CONFIG.placeholderImage;
  const allImages = Array.isArray(product.imageURLs) && product.imageURLs.length > 0
    ? product.imageURLs
    : [product.imageURL || fallbackImg];

  const primaryImg = allImages[0] || fallbackImg;

  if (mainImageEl) {
    mainImageEl.src = primaryImg;
    mainImageEl.alt = product.name;
    mainImageEl.onerror = () => {
      mainImageEl.onerror = null;
      mainImageEl.src = fallbackImg;
    };
  }

  // Badges
  if (badgesContainer) {
    const isSample = Boolean(product.isSample || String(product.id).startsWith('demo-'));
    const badges = [
      isSample
        ? '<span class="product-card__badge product-card__badge--sample">Sample Demo</span>'
        : '<span class="product-card__badge product-card__badge--cold-pressed">Verified Pure</span>',
      product.tags?.includes('organic') ? '<span class="product-card__badge product-card__badge--organic">Organic</span>' : '',
      product.tags?.includes('cold-pressed') ? '<span class="product-card__badge product-card__badge--cold-pressed">Wood-Pressed</span>' : ''
    ].filter(Boolean);
    badgesContainer.innerHTML = badges.join('');
  }

  // Thumbnails if multiple images
  if (thumbsContainer) {
    if (allImages.length > 1) {
      thumbsContainer.innerHTML = allImages.map((url, idx) => `
        <div class="product-gallery__thumb ${idx === 0 ? 'is-active' : ''}" data-index="${idx}">
          <img src="${sanitizeHTML(url)}" alt="Thumbnail ${idx + 1}" onerror="this.onerror=null; this.src='${fallbackImg}';" />
        </div>
      `).join('');

      thumbsContainer.querySelectorAll('.product-gallery__thumb').forEach(thumb => {
        thumb.addEventListener('click', () => {
          thumbsContainer.querySelectorAll('.product-gallery__thumb').forEach(t => t.classList.remove('is-active'));
          thumb.classList.add('is-active');
          const idx = parseInt(thumb.getAttribute('data-index'), 10);
          if (mainImageEl && allImages[idx]) {
            mainImageEl.src = allImages[idx];
          }
        });
      });
    } else {
      thumbsContainer.innerHTML = '';
    }
  }
}

/**
 * Render variant selection pills.
 */
function renderVariants(variants) {
  if (!variantContainer) return;

  variantContainer.innerHTML = variants.map(v => {
    const isSelected = v === selectedVariant;
    const vPrice = (v.discountPrice && v.discountPrice > 0 && v.discountPrice < v.price) ? v.discountPrice : v.price;
    const vId = v.variantId || v.id || v.sku || v.size;

    return `
      <button type="button" class="variant-pill ${isSelected ? 'is-selected' : ''}" data-variant-id="${vId}">
        <span class="variant-pill__size">${sanitizeHTML(v.size)}</span>
        <span class="variant-pill__price">${formatPrice(vPrice)}</span>
      </button>
    `;
  }).join('');

  variantContainer.querySelectorAll('.variant-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const vId = btn.getAttribute('data-variant-id');
      const clicked = variants.find(v => (v.variantId || v.id || v.sku || v.size) === vId);
      if (clicked) {
        selectedVariant = clicked;
        currentQuantity = 1;
        variantContainer.querySelectorAll('.variant-pill').forEach(b => b.classList.remove('is-selected'));
        btn.classList.add('is-selected');
        updateVariantDisplay();
      }
    });
  });
}

/**
 * Update pricing, SKU, stock status, and stepper bounds when selected variant changes.
 */
function updateVariantDisplay() {
  if (!selectedVariant) return;

  const regPrice = Number(selectedVariant.price) || 0;
  const discPrice = (selectedVariant.discountPrice && Number(selectedVariant.discountPrice) > 0 && Number(selectedVariant.discountPrice) < regPrice)
    ? Number(selectedVariant.discountPrice)
    : null;
  const activePrice = discPrice !== null ? discPrice : regPrice;

  // Display price
  if (displayPriceEl) displayPriceEl.textContent = formatPrice(activePrice);

  // Original strikethrough price & discount percent
  if (discPrice !== null) {
    if (originalPriceEl) {
      originalPriceEl.textContent = formatPrice(regPrice);
      originalPriceEl.classList.remove('hidden');
    }
    if (discountBadgeEl) {
      const pct = Math.round((1 - discPrice / regPrice) * 100);
      discountBadgeEl.textContent = `${pct}% OFF`;
      discountBadgeEl.classList.remove('hidden');
    }
  } else {
    originalPriceEl?.classList.add('hidden');
    discountBadgeEl?.classList.add('hidden');
  }

  // SKU
  if (skuEl) skuEl.textContent = selectedVariant.sku ? `SKU: ${selectedVariant.sku}` : '';

  // Stock status
  const stock = selectedVariant.stock !== undefined ? parseInt(selectedVariant.stock, 10) : 50;
  if (stockStatusEl) {
    if (stock <= 0) {
      stockStatusEl.textContent = 'Out of Stock';
      stockStatusEl.className = 'variant-selector__stock-status stock-out';
      if (btnAddToCart) {
        btnAddToCart.disabled = true;
        btnAddToCart.textContent = 'Out of Stock';
      }
    } else if (stock <= 5) {
      stockStatusEl.textContent = `Only ${stock} left in stock!`;
      stockStatusEl.className = 'variant-selector__stock-status stock-low';
      if (btnAddToCart) {
        btnAddToCart.disabled = false;
        btnAddToCart.textContent = '🛒 Add to Cart';
      }
    } else {
      stockStatusEl.textContent = `In Stock (${stock} available)`;
      stockStatusEl.className = 'variant-selector__stock-status stock-in';
      if (btnAddToCart) {
        btnAddToCart.disabled = false;
        btnAddToCart.textContent = '🛒 Add to Cart';
      }
    }
  }

  // Stepper value
  updateQuantityDisplay();
  updateWhatsAppButton();
}

/**
 * Update quantity display and buttons.
 */
function updateQuantityDisplay() {
  const stock = selectedVariant?.stock !== undefined ? parseInt(selectedVariant.stock, 10) : 50;
  if (qtyValEl) qtyValEl.textContent = currentQuantity;

  if (btnQtyMinus) btnQtyMinus.disabled = currentQuantity <= 1;
  if (btnQtyPlus) btnQtyPlus.disabled = stock > 0 && currentQuantity >= stock;
}

/**
 * Wire quantity stepper, Add to Cart, and WhatsApp Enquiry actions.
 */
function wireActionButtons() {
  btnQtyMinus?.addEventListener('click', () => {
    if (currentQuantity > 1) {
      currentQuantity--;
      updateQuantityDisplay();
    }
  });

  btnQtyPlus?.addEventListener('click', () => {
    const stock = selectedVariant?.stock !== undefined ? parseInt(selectedVariant.stock, 10) : 50;
    if (stock <= 0 || currentQuantity < stock) {
      currentQuantity++;
      updateQuantityDisplay();
    }
  });

  btnAddToCart?.addEventListener('click', () => {
    if (!currentProduct || !selectedVariant) return;

    const res = addToCart(currentProduct, selectedVariant, currentQuantity);
    if (res.success) {
      showToast(`Added ${currentQuantity} × "${currentProduct.name} (${selectedVariant.size})" to cart.`, 'success');
      openCartDrawer();
    } else {
      showToast(res.message || 'Could not add item to cart.', 'error');
    }
  });

  updateWhatsAppButton();
}

/**
 * Update WhatsApp Enquiry button state based on STORE_CONFIG.whatsappPhone.
 */
function updateWhatsAppButton() {
  if (!btnWhatsApp) return;

  const isConfigured = isWhatsAppConfigured();

  if (!isConfigured) {
    btnWhatsApp.disabled = true;
    btnWhatsApp.title = 'WhatsApp ordering is currently unconfigured by the store owner.';
    btnWhatsApp.textContent = '💬 WhatsApp Enquiry (Not Configured)';
    return;
  }

  btnWhatsApp.disabled = false;
  btnWhatsApp.title = 'Enquire about this oil directly on WhatsApp';
  btnWhatsApp.textContent = '💬 Enquire on WhatsApp';

  // Attach click handler with current variant data
  btnWhatsApp.onclick = () => {
    if (!currentProduct || !selectedVariant) return;

    const activePrice = (selectedVariant.discountPrice && selectedVariant.discountPrice > 0 && selectedVariant.discountPrice < selectedVariant.price)
      ? selectedVariant.discountPrice
      : selectedVariant.price;

    const message = `வணக்கம் / Hello ${STORE_CONFIG.storeName},
I am interested in your cooking oil:
- Product: ${currentProduct.name} ${currentProduct.nameTamil ? `(${currentProduct.nameTamil})` : ''}
- Size: ${selectedVariant.size} (SKU: ${selectedVariant.sku || 'N/A'})
- Price: ${formatPrice(activePrice)}
- Quantity: ${currentQuantity}
- Product Link: ${window.location.href}

Could you please confirm availability and delivery?`;

    const url = buildWhatsAppLink(message);
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };
}

/**
 * Synchronize navbar auth state on the product details page.
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

  // Sign-in click
  signInBtn?.addEventListener('click', async () => {
    try {
      await signInWithGoogle();
    } catch (err) {
      showToast(err.message || 'Sign in failed.', 'error');
    }
  });

  // User menu toggle
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

  initAuthObserver((user, profile) => {
    if (user) {
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
    } else {
      signInBtn?.classList.remove('hidden');
      userMenuContainer?.classList.add('hidden');
      adminLink?.classList.add('hidden');
    }
  });
}

// Bootstrap
document.addEventListener('DOMContentLoaded', initProductPage);

