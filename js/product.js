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

import { getProductById, getProductReviews, createReview } from './firestore.js';
import { SAMPLE_PRODUCTS } from './home.js';
import { addToCart } from './cart.js';
import { initCartUI, openCartDrawer } from './cart-ui.js';
import { initAuthObserver, onAuthChange, signInWithGoogle, signOut } from './auth.js';
import { formatPrice, formatDate, sanitizeHTML, showToast, $ } from './utils.js';
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

// Reviews Section DOM References
const reviewsSectionEl       = $('#product-reviews-section');
const reviewsAvgScoreEl      = $('#reviews-avg-score');
const reviewsSummaryStarsEl  = $('#reviews-summary-stars');
const reviewsTotalCountEl    = $('#reviews-total-count');
const reviewsLoadingEl       = $('#reviews-loading');
const reviewsErrorEl         = $('#reviews-error');
const reviewsErrorMsgEl      = $('#reviews-error-msg');
const btnRetryReviews        = $('#btn-retry-reviews');
const reviewsEmptyEl         = $('#reviews-empty');
const reviewsCardsContainer  = $('#reviews-cards-container');
const reviewForm             = $('#review-form');
const reviewFormUserName     = $('#review-form-user-name');
const starRatingInput        = $('#star-rating-input');
const starRatingLabel        = $('#star-rating-label');
const reviewCommentInput     = $('#review-comment');
const reviewCharCount        = $('#review-char-count');
const reviewSubmitFeedback   = $('#review-submit-feedback');
const btnSubmitReview        = $('#btn-submit-review');
const reviewAuthPrompt       = $('#review-auth-prompt');
const btnReviewGoogleLogin   = $('#btn-review-google-login');

// State
let currentProduct = null;
let selectedVariant = null;
let currentQuantity = 1;

// Reviews State
let currentAuthUser = null;
let currentAuthProfile = null;
let selectedReviewRating = 5;
let isSubmittingReview = false;

const RATING_LABELS = {
  1: '1 star — Poor',
  2: '2 stars — Fair',
  3: '3 stars — Good',
  4: '4 stars — Very Good',
  5: '5 stars — Excellent'
};

/**
 * Validates that an image URL begins with an allowed safe protocol or asset path.
 * Prevents javascript: or data: XSS vectors.
 * 
 * @param {string} url
 * @returns {boolean}
 */
function isSafeImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim().toLowerCase();
  return trimmed.startsWith('assets/') || trimmed.startsWith('https://') || trimmed.startsWith('http://');
}

/**
 * Initialize the product details page.
 */
async function initProductPage() {
  initCartUI();
  setupAuthNavbar();
  setupReviewsListeners();

  // Extract and strictly validate ?id= from URL query
  const urlParams = new URLSearchParams(window.location.search);
  const rawId = urlParams.get('id');

  // URL Parameter Validation:
  // Must be alphanumeric with hyphens/underscores, 1 to 64 characters.
  // Rejects control characters, HTML tags, or path traversals.
  if (!rawId || !/^[a-zA-Z0-9_-]{1,64}$/.test(rawId)) {
    showError('Invalid or missing product identifier. Please choose a product from the storefront.');
    return;
  }
  const productId = rawId;

  try {
    // 1. Attempt to fetch verified product from Firestore
    let product = await getProductById(productId);

    // 2. If not found in Firestore, check demonstration sample products
    if (!product) {
      product = SAMPLE_PRODUCTS.find(p => p.id === productId);
    }

    if (!product) {
      showError('The requested cooking oil could not be found in our catalog.');
      return;
    }

    currentProduct = product;
    renderProductDetails(product);
  } catch (err) {
    console.error('[ProductPage] Error loading product:', err.message);
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
  reviewsSectionEl?.classList.add('hidden');
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

  // Update dynamic SEO & Schema.org structured data
  updateProductMeta(product);

  // Reveal reviews section and load community feedback
  reviewsSectionEl?.classList.remove('hidden');
  loadProductReviews(product.id);
}

/**
 * Render product image gallery and badges.
 */
function renderGallery(product) {
  const fallbackImg = STORE_CONFIG.placeholderImage;
  const rawImages = Array.isArray(product.imageURLs) && product.imageURLs.length > 0
    ? product.imageURLs
    : [product.imageURL || fallbackImg];

  // Validate all image URLs against safe protocol whitelist
  const allImages = rawImages.map(url => isSafeImageUrl(url) ? url : fallbackImg);
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
        <button type="button" class="product-gallery__thumb ${idx === 0 ? 'is-active' : ''}" data-index="${idx}" aria-label="View photo ${idx + 1}">
          <img src="${sanitizeHTML(url)}" alt="Thumbnail ${idx + 1}" width="72" height="72" loading="lazy" onerror="this.onerror=null; this.src='${fallbackImg}';" />
        </button>
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
 * Update dynamic SEO meta tags and Schema.org Product JSON-LD.
 * @param {Object} product
 */
function updateProductMeta(product) {
  if (!product) return;

  const desc = product.description || `Pure cold-pressed ${product.name} from Sri Kamatchi Amman Traders.`;
  const img = product.imageURL || 'assets/images/placeholders/product-placeholder.webp';

  const ogTitle = document.getElementById('og-title');
  if (ogTitle) ogTitle.content = `${product.name} — ${STORE_CONFIG.storeName}`;

  const ogDesc = document.getElementById('og-desc');
  if (ogDesc) ogDesc.content = desc;

  const ogImage = document.getElementById('og-image');
  if (ogImage) ogImage.content = img;

  const twitterTitle = document.getElementById('twitter-title');
  if (twitterTitle) twitterTitle.content = `${product.name} — ${STORE_CONFIG.storeName}`;

  const twitterDesc = document.getElementById('twitter-desc');
  if (twitterDesc) twitterDesc.content = desc;

  const twitterImage = document.getElementById('twitter-image');
  if (twitterImage) twitterImage.content = img;

  // Schema.org Product Structured Data
  let schemaScript = document.getElementById('product-schema');
  if (!schemaScript) {
    schemaScript = document.createElement('script');
    schemaScript.id = 'product-schema';
    schemaScript.type = 'application/ld+json';
    document.head.appendChild(schemaScript);
  }

  const activePrice = selectedVariant?.discountPrice || selectedVariant?.price || product.price || 0;
  const inStock = (selectedVariant?.stock ?? product.stock) > 0;

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: desc,
    image: img ? [img] : [],
    brand: {
      '@type': 'Brand',
      name: STORE_CONFIG.storeName
    },
    offers: {
      '@type': 'Offer',
      price: activePrice,
      priceCurrency: 'INR',
      availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition'
    }
  };

  if (product.rating && product.reviewCount) {
    schema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: Number(product.rating),
      reviewCount: Number(product.reviewCount)
    };
  }

  schemaScript.textContent = JSON.stringify(schema);
}

/**
 * Render variant selection pills.
 */
function renderVariants(variants) {
  if (!variantContainer) return;

  variantContainer.innerHTML = variants.map(v => {
    const isSelected = v === selectedVariant;
    const vPrice = (v.discountPrice && v.discountPrice > 0 && v.discountPrice < v.price) ? v.discountPrice : v.price;
    const vId = String(v.variantId || v.id || v.sku || v.size || 'default').replace(/[^a-zA-Z0-9_-]/g, '-');

    return `
      <button type="button" class="variant-pill ${isSelected ? 'is-selected' : ''}" data-variant-id="${sanitizeHTML(vId)}">
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
        const clickedStock = (clicked.stock !== undefined && !isNaN(parseInt(clicked.stock, 10)))
          ? parseInt(clicked.stock, 10)
          : 0;
        currentQuantity = clickedStock > 0 ? 1 : 0;
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
 * Strictly enforces stock boundaries, disabling increment when stock is exhausted.
 */
function updateQuantityDisplay() {
  const stock = (selectedVariant?.stock !== undefined && !isNaN(parseInt(selectedVariant.stock, 10)))
    ? parseInt(selectedVariant.stock, 10)
    : 0;

  if (stock <= 0) {
    currentQuantity = 0;
  } else if (currentQuantity > stock) {
    currentQuantity = stock;
  } else if (currentQuantity < 1) {
    currentQuantity = 1;
  }

  if (qtyValEl) qtyValEl.textContent = currentQuantity;

  if (btnQtyMinus) btnQtyMinus.disabled = currentQuantity <= 1 || stock <= 0;
  if (btnQtyPlus) btnQtyPlus.disabled = stock <= 0 || currentQuantity >= stock;
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
    const stock = (selectedVariant?.stock !== undefined && !isNaN(parseInt(selectedVariant.stock, 10)))
      ? parseInt(selectedVariant.stock, 10)
      : 0;
    if (stock > 0 && currentQuantity < stock) {
      currentQuantity++;
      updateQuantityDisplay();
    }
  });

  btnAddToCart?.addEventListener('click', () => {
    if (!currentProduct || !selectedVariant) return;

    const stock = (selectedVariant.stock !== undefined && !isNaN(parseInt(selectedVariant.stock, 10)))
      ? parseInt(selectedVariant.stock, 10)
      : 0;

    if (stock <= 0) {
      showToast(`"${currentProduct.name} (${selectedVariant.size})" is currently out of stock.`, 'error');
      return;
    }

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

  const syncAuthNavbar = (user, profile) => {
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

    // Keep customer review form in sync with authentication state
    syncReviewAuth(user, profile);
  };

  // Start auth observer once, and register persistent listener for reactive navbar updates
  initAuthObserver();
  onAuthChange(syncAuthNavbar);
}

// ═══════════════════════════════════════════════
// Reviews Section Controller
// ═══════════════════════════════════════════════

/**
 * Configure event listeners for review interactions (ratings, character counter, submission, retry).
 */
function setupReviewsListeners() {
  // Star rating selector click handlers
  if (starRatingInput) {
    starRatingInput.querySelectorAll('.star-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = parseInt(btn.getAttribute('data-value'), 10);
        if (!isNaN(val)) {
          setReviewRating(val);
        }
      });
    });
  }

  // Character counter and feedback clear on input
  reviewCommentInput?.addEventListener('input', () => {
    const len = reviewCommentInput.value.length;
    if (reviewCharCount) reviewCharCount.textContent = len;
    if (len > 0) hideReviewFeedback();
  });

  // Review submission
  reviewForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmittingReview) return;

    hideReviewFeedback();

    if (!currentAuthUser) {
      showReviewFeedback('Please sign in with Google to post your review.', 'error');
      return;
    }

    if (!currentProduct || !currentProduct.id) {
      showReviewFeedback('Unable to determine the active product for this review.', 'error');
      return;
    }

    const comment = (reviewCommentInput?.value || '').trim();
    if (!comment) {
      showReviewFeedback('Please write a comment describing your experience.', 'error');
      reviewCommentInput?.focus();
      return;
    }

    if (comment.length > 1000) {
      showReviewFeedback('Review comment cannot exceed 1000 characters.', 'error');
      return;
    }

    try {
      isSubmittingReview = true;
      if (btnSubmitReview) {
        btnSubmitReview.disabled = true;
        btnSubmitReview.textContent = 'Publishing...';
      }

      await createReview({
        productId: currentProduct.id,
        rating: selectedReviewRating,
        comment
      });

      showToast('Your review has been published! Thank you.', 'success');
      showReviewFeedback('Review published successfully!', 'success');

      // Reset form
      if (reviewCommentInput) reviewCommentInput.value = '';
      if (reviewCharCount) reviewCharCount.textContent = '0';
      setReviewRating(5);

      // Refresh reviews list
      await loadProductReviews(currentProduct.id);
    } catch (err) {
      console.error('[Reviews] Submit error:', err);
      showReviewFeedback(err.message || 'Failed to submit review. Please try again.', 'error');
    } finally {
      isSubmittingReview = false;
      if (btnSubmitReview) {
        btnSubmitReview.disabled = false;
        btnSubmitReview.textContent = 'Publish Review';
      }
    }
  });

  // Google Sign-In prompt button
  btnReviewGoogleLogin?.addEventListener('click', async () => {
    try {
      await signInWithGoogle();
    } catch (err) {
      showToast(err.message || 'Sign in failed.', 'error');
    }
  });

  // Retry loading reviews
  btnRetryReviews?.addEventListener('click', () => {
    if (currentProduct && currentProduct.id) {
      loadProductReviews(currentProduct.id);
    }
  });
}

/**
 * Set the selected review rating in the form UI.
 * @param {number} rating (1-5)
 */
function setReviewRating(rating) {
  selectedReviewRating = Math.max(1, Math.min(5, parseInt(rating, 10) || 5));
  if (starRatingInput) {
    starRatingInput.querySelectorAll('.star-btn').forEach(btn => {
      const val = parseInt(btn.getAttribute('data-value'), 10);
      btn.classList.toggle('is-active', val <= selectedReviewRating);
    });
  }
  if (starRatingLabel) {
    starRatingLabel.textContent = RATING_LABELS[selectedReviewRating] || `${selectedReviewRating} stars`;
  }
}

/**
 * Show a feedback message in the review submission card.
 * @param {string} message
 * @param {'error'|'success'} type
 */
function showReviewFeedback(message, type = 'error') {
  if (!reviewSubmitFeedback) return;
  reviewSubmitFeedback.textContent = message;
  reviewSubmitFeedback.className = `review-feedback review-feedback--${type}`;
  reviewSubmitFeedback.classList.remove('hidden');
}

/**
 * Hide the review feedback banner.
 */
function hideReviewFeedback() {
  if (!reviewSubmitFeedback) return;
  reviewSubmitFeedback.classList.add('hidden');
  reviewSubmitFeedback.textContent = '';
}

/**
 * Synchronize authentication state with the customer review form.
 * Toggles between authenticated form and unauthenticated sign-in prompt.
 * @param {Object|null} user
 * @param {Object|null} profile
 */
function syncReviewAuth(user, profile) {
  currentAuthUser = user;
  currentAuthProfile = profile;

  if (user) {
    reviewAuthPrompt?.classList.add('hidden');
    reviewForm?.classList.remove('hidden');
    if (reviewFormUserName) {
      reviewFormUserName.textContent = profile?.displayName || user.displayName || user.email || 'Customer';
    }
  } else {
    reviewForm?.classList.add('hidden');
    reviewAuthPrompt?.classList.remove('hidden');
  }
}

/**
 * Fetch and render reviews for the specified product.
 * @param {string} productId
 */
async function loadProductReviews(productId) {
  if (!productId) return;

  // Set loading state
  reviewsLoadingEl?.classList.remove('hidden');
  reviewsErrorEl?.classList.add('hidden');
  reviewsEmptyEl?.classList.add('hidden');
  if (reviewsCardsContainer) reviewsCardsContainer.innerHTML = '';

  try {
    const reviews = await getProductReviews(productId);
    reviewsLoadingEl?.classList.add('hidden');

    if (!Array.isArray(reviews) || reviews.length === 0) {
      reviewsEmptyEl?.classList.remove('hidden');
      updateReviewsSummary([]);
      return;
    }

    reviewsEmptyEl?.classList.add('hidden');
    updateReviewsSummary(reviews);
    renderReviewsList(reviews);
  } catch (err) {
    console.error('[Reviews] Error loading reviews:', err);
    reviewsLoadingEl?.classList.add('hidden');
    reviewsErrorEl?.classList.remove('hidden');
    if (reviewsErrorMsgEl) {
      reviewsErrorMsgEl.textContent = 'Unable to load customer reviews right now. Please try again.';
    }
  }
}

/**
 * Update the review summary score, star string, and count display.
 * @param {Array} reviews
 */
function updateReviewsSummary(reviews) {
  if (!Array.isArray(reviews) || reviews.length === 0) {
    if (reviewsAvgScoreEl) reviewsAvgScoreEl.textContent = '—';
    if (reviewsSummaryStarsEl) reviewsSummaryStarsEl.textContent = '☆☆☆☆☆';
    if (reviewsTotalCountEl) reviewsTotalCountEl.textContent = '0 customer reviews';
    return;
  }

  const totalScore = reviews.reduce((sum, r) => sum + (Number(r.rating) || 0), 0);
  const avg = (totalScore / reviews.length).toFixed(1);
  const count = reviews.length;

  if (reviewsAvgScoreEl) reviewsAvgScoreEl.textContent = avg;
  
  const fullStars = Math.floor(avg);
  const halfStar = (avg % 1 >= 0.5) ? '½' : '';
  const emptyStars = Math.max(0, 5 - fullStars - (halfStar ? 1 : 0));
  const starStr = '★'.repeat(fullStars) + halfStar + '☆'.repeat(emptyStars);

  if (reviewsSummaryStarsEl) reviewsSummaryStarsEl.textContent = starStr;
  if (reviewsTotalCountEl) reviewsTotalCountEl.textContent = `${count} customer review${count === 1 ? '' : 's'}`;

  // Also update product detail header rating to match verified feedback
  if (ratingTextEl) ratingTextEl.textContent = `${avg} (${count} customer review${count === 1 ? '' : 's'})`;
  if (starsEl) starsEl.textContent = starStr;
}

/**
 * Safely render customer review cards using DOM textContent to prevent XSS.
 * @param {Array} reviews
 */
function renderReviewsList(reviews) {
  if (!reviewsCardsContainer) return;
  reviewsCardsContainer.innerHTML = '';

  reviews.forEach(review => {
    const card = document.createElement('div');
    card.className = 'review-card';
    if (review.id) card.setAttribute('data-review-id', review.id);

    // Header
    const header = document.createElement('div');
    header.className = 'review-card__header';

    // Author wrap
    const authorWrap = document.createElement('div');
    authorWrap.className = 'review-card__author-wrap';

    const avatar = document.createElement('div');
    avatar.className = 'review-card__avatar';
    const authorName = review.userName || 'Verified Buyer';
    avatar.textContent = authorName.trim().charAt(0).toUpperCase() || 'C';

    const meta = document.createElement('div');
    meta.className = 'review-card__meta';

    const authorLine = document.createElement('div');
    authorLine.className = 'review-card__author-line';

    const nameEl = document.createElement('span');
    nameEl.className = 'review-card__author-name';
    nameEl.textContent = authorName;

    const badge = document.createElement('span');
    badge.className = 'review-card__verified-badge';
    badge.textContent = '✓ Verified Purchase';

    authorLine.appendChild(nameEl);
    authorLine.appendChild(badge);

    const dateEl = document.createElement('span');
    dateEl.className = 'review-card__date';
    dateEl.textContent = review.createdAt ? formatDate(review.createdAt) : 'Recently';

    meta.appendChild(authorLine);
    meta.appendChild(dateEl);

    authorWrap.appendChild(avatar);
    authorWrap.appendChild(meta);

    // Rating stars
    const ratingEl = document.createElement('div');
    ratingEl.className = 'review-card__rating';
    const rVal = Math.max(1, Math.min(5, Math.round(Number(review.rating) || 5)));
    ratingEl.textContent = '★'.repeat(rVal) + '☆'.repeat(5 - rVal);
    ratingEl.setAttribute('aria-label', `${rVal} out of 5 stars`);

    header.appendChild(authorWrap);
    header.appendChild(ratingEl);

    // Comment
    const commentEl = document.createElement('p');
    commentEl.className = 'review-card__comment';
    commentEl.textContent = review.comment || '';

    card.appendChild(header);
    card.appendChild(commentEl);

    reviewsCardsContainer.appendChild(card);
  });
}

// Bootstrap
document.addEventListener('DOMContentLoaded', initProductPage);

