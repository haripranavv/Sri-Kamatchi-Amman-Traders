/**
 * home.js — Homepage & Storefront Module
 *
 * Renders the storefront homepage with real-time Firestore synchronization:
 * - Subscribes to active products from Cloud Firestore
 * - Distinguishes verified real products from demonstration sample data
 * - Displays variant-specific prices and sizes
 * - Category listing and sample testimonials
 */

import { formatPrice, sanitizeHTML } from './utils.js';
import { subscribeToProducts } from './firestore.js';

// ═══════════════════════════════════════════════
// SAMPLE DATA — For demonstration only
// ═══════════════════════════════════════════════

/**
 * Sample product catalog.
 * These are demonstration products. Prices, ratings, and descriptions
 * are fictional and do not represent real business claims.
 */
export const SAMPLE_PRODUCTS = [
  {
    id: 'demo-sesame-1L',
    name: 'Cold Pressed Sesame Oil',
    nameTamil: 'செக்கு நல்லெண்ணெய்',
    category: 'sesame',
    imageURL: 'assets/images/products/sesame-oil.webp',
    price: 450,
    discountPrice: 399,
    unit: '1L',
    sizes: ['500ml', '1L', '2L', '5L'],
    variants: [
      { size: '500ml', sku: 'SES-500ML', price: 240, discountPrice: 210, stock: 40, isDefault: false },
      { size: '1L', sku: 'SES-1L', price: 450, discountPrice: 399, stock: 50, isDefault: true },
      { size: '5L', sku: 'SES-5L', price: 2100, discountPrice: 1899, stock: 15, isDefault: false }
    ],
    emoji: '🫒',
    tags: ['organic', 'cold-pressed'],
    rating: 4.5,
    reviewCount: 23,
    description: 'Traditional stone-ground sesame oil with a rich aroma.',
    isSample: true
  },
  {
    id: 'demo-coconut-1L',
    name: 'Virgin Coconut Oil',
    nameTamil: 'செக்கு தேங்காய் எண்ணெய்',
    category: 'coconut',
    imageURL: 'assets/images/products/coconut-oil.webp',
    price: 380,
    discountPrice: 349,
    unit: '1L',
    sizes: ['500ml', '1L', '2L'],
    variants: [
      { size: '500ml', sku: 'COC-500ML', price: 200, discountPrice: 180, stock: 35, isDefault: false },
      { size: '1L', sku: 'COC-1L', price: 380, discountPrice: 349, stock: 40, isDefault: true }
    ],
    emoji: '🥥',
    tags: ['organic', 'cold-pressed'],
    rating: 4.7,
    reviewCount: 41,
    description: 'Pure cold-pressed coconut oil for cooking and wellness.',
    isSample: true
  },
  {
    id: 'demo-groundnut-1L',
    name: 'Groundnut Oil',
    nameTamil: 'செக்கு கடலை எண்ணெய்',
    category: 'groundnut',
    imageURL: 'assets/images/products/groundnut-oil.webp',
    price: 320,
    discountPrice: 289,
    unit: '1L',
    sizes: ['500ml', '1L', '5L'],
    variants: [
      { size: '1L', sku: 'GRO-1L', price: 320, discountPrice: 289, stock: 60, isDefault: true }
    ],
    emoji: '🥜',
    tags: ['cold-pressed'],
    rating: 4.3,
    reviewCount: 18,
    description: 'Light and nutty groundnut oil for everyday cooking.',
    isSample: true
  },
  {
    id: 'demo-gingelly-500ml',
    name: 'Gingelly Oil',
    nameTamil: 'நல்லெண்ணெய்',
    category: 'gingelly',
    imageURL: 'assets/images/products/gingelly-oil.webp',
    price: 280,
    discountPrice: null,
    unit: '500ml',
    sizes: ['200ml', '500ml', '1L'],
    variants: [
      { size: '500ml', sku: 'GIN-500ML', price: 280, discountPrice: null, stock: 30, isDefault: true }
    ],
    emoji: '✨',
    tags: ['traditional'],
    rating: 4.6,
    reviewCount: 35,
    description: 'Premium gingelly oil used in Tamil Nadu kitchens for generations.',
    isSample: true
  },
  {
    id: 'demo-mustard-1L',
    name: 'Cold Pressed Mustard Oil',
    nameTamil: 'செக்கு கடுகு எண்ணெய்',
    category: 'mustard',
    imageURL: 'assets/images/products/mustard-oil.webp',
    price: 290,
    discountPrice: 259,
    unit: '1L',
    sizes: ['500ml', '1L', '2L'],
    variants: [
      { size: '1L', sku: 'MUS-1L', price: 290, discountPrice: 259, stock: 25, isDefault: true }
    ],
    emoji: '🌿',
    tags: ['cold-pressed'],
    rating: 4.2,
    reviewCount: 12,
    description: 'Pungent and flavourful mustard oil for pickles and cooking.',
    isSample: true
  },
  {
    id: 'demo-sunflower-2L',
    name: 'Sunflower Oil',
    nameTamil: 'சூரியகாந்தி எண்ணெய்',
    category: 'sunflower',
    imageURL: 'assets/images/products/sunflower-oil.webp',
    price: 420,
    discountPrice: 379,
    unit: '2L',
    sizes: ['1L', '2L', '5L'],
    variants: [
      { size: '2L', sku: 'SUN-2L', price: 420, discountPrice: 379, stock: 30, isDefault: true }
    ],
    emoji: '🌻',
    tags: ['light', 'everyday'],
    rating: 4.1,
    reviewCount: 9,
    description: 'Light and healthy sunflower oil for heart-conscious cooking.',
    isSample: true
  }
];


/** Product categories with emoji icons. */
export const CATEGORIES = [
  { id: 'sesame',    name: 'Sesame Oil',    nameTamil: 'நல்லெண்ணெய்',     emoji: '🫒', count: 4 },
  { id: 'coconut',   name: 'Coconut Oil',   nameTamil: 'தேங்காய் எண்ணெய்', emoji: '🥥', count: 3 },
  { id: 'groundnut', name: 'Groundnut Oil', nameTamil: 'கடலை எண்ணெய்',    emoji: '🥜', count: 3 },
  { id: 'gingelly',  name: 'Gingelly Oil',  nameTamil: 'நல்லெண்ணெய்',     emoji: '✨', count: 2 },
  { id: 'mustard',   name: 'Mustard Oil',   nameTamil: 'கடுகு எண்ணெய்',    emoji: '🌿', count: 2 },
  { id: 'sunflower', name: 'Sunflower Oil', nameTamil: 'சூரியகாந்தி எண்ணெய்', emoji: '🌻', count: 2 }
];


/**
 * Sample testimonials — fictional, for demonstration only.
 * These do not represent real customer reviews.
 */
export const SAMPLE_TESTIMONIALS = [
  {
    name: 'Priya S.',
    location: 'Chennai',
    initials: 'PS',
    rating: 5,
    quote: 'The sesame oil quality is outstanding. My family has been using it for all our cooking since we discovered this shop.'
  },
  {
    name: 'Karthik R.',
    location: 'Madurai',
    initials: 'KR',
    rating: 5,
    quote: 'Genuinely cold-pressed oils at fair prices. The groundnut oil makes the best tasting food.'
  },
  {
    name: 'Lakshmi M.',
    location: 'Coimbatore',
    initials: 'LM',
    rating: 4,
    quote: 'Fast delivery and excellent packaging. The coconut oil stays fresh for months. Very happy customer!'
  }
];


// ═══════════════════════════════════════════════
// RENDERING FUNCTIONS
// ═══════════════════════════════════════════════

/**
 * Render star icons for a given rating.
 * @param {number} rating - Rating out of 5
 * @returns {string} HTML string of star characters
 */
function renderStars(rating) {
  const full = Math.floor(rating);
  const half = rating % 1 >= 0.5 ? 1 : 0;
  const empty = Math.max(0, 5 - full - half);
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
}


/**
 * Create HTML for a single product card.
 * @param {Object} product
 * @returns {string} HTML string
 */
export function renderProductCard(product) {
  const hasDiscount = product.discountPrice && product.discountPrice < product.price;
  const displayPrice = hasDiscount ? product.discountPrice : product.price;
  const discountPercent = hasDiscount
    ? Math.round((1 - product.discountPrice / product.price) * 100)
    : 0;

  // Build badges: explicit distinction between real Firestore product and sample demo
  const badgesHTML = [
    product.isSample
      ? '<span class="product-card__badge product-card__badge--sample">Sample Demo</span>'
      : '<span class="product-card__badge product-card__badge--cold-pressed">Verified Product</span>',
    product.tags?.includes('organic') ? '<span class="product-card__badge product-card__badge--organic">Organic</span>' : '',
    product.tags?.includes('cold-pressed') ? '<span class="product-card__badge product-card__badge--cold-pressed">Cold Pressed</span>' : '',
    hasDiscount ? `<span class="product-card__badge product-card__badge--sale">${discountPercent}% Off</span>` : ''
  ].filter(Boolean).join('\n');

  // Media: Local image path or graceful fallback placeholder
  const fallbackPlaceholder = 'assets/images/placeholders/product-placeholder.webp';
  let mediaHTML;
  const imageSrc = product.imageURL || (Array.isArray(product.imageURLs) && product.imageURLs[0]);
  if (imageSrc) {
    mediaHTML = `<img src="${sanitizeHTML(imageSrc)}" alt="${sanitizeHTML(product.name)}" style="width: 100%; height: 100%; object-fit: cover;" loading="lazy" onerror="this.onerror=null; this.src='${fallbackPlaceholder}';" />`;
  } else {
    mediaHTML = `<img src="${fallbackPlaceholder}" alt="${sanitizeHTML(product.name)}" style="width: 100%; height: 100%; object-fit: cover;" loading="lazy" />`;
  }

  // Variant size description
  let sizeText = product.unit || '1L';
  if (product.variants && product.variants.length > 1) {
    sizeText = `${product.variants.length} sizes available (${product.variants.map(v => v.size).join(', ')})`;
  } else if (product.sizes && product.sizes.length > 1) {
    sizeText = `${product.sizes.length} sizes available (${product.sizes.join(', ')})`;
  }

  return `
    <article class="product-card reveal" data-product-id="${product.id}">
      <div class="product-card__image-wrap">
        ${mediaHTML}
        <div class="product-card__badges">
          ${badgesHTML}
        </div>
      </div>
      <div class="product-card__body">
        <p class="product-card__category">${sanitizeHTML(product.category || 'oil')}</p>
        <h3 class="product-card__name">${sanitizeHTML(product.name)}</h3>
        ${product.nameTamil ? `<p class="product-card__name-tamil">${sanitizeHTML(product.nameTamil)}</p>` : ''}
        <p class="product-card__size">${sanitizeHTML(sizeText)}</p>
        <div class="product-card__pricing">
          <span class="product-card__price">${formatPrice(displayPrice)}</span>
          ${hasDiscount ? `
            <span class="product-card__original-price">${formatPrice(product.price)}</span>
            <span class="product-card__discount">Save ${discountPercent}%</span>
          ` : ''}
        </div>
        <div class="product-card__rating">
          <span class="product-card__stars" aria-label="Rating: ${product.rating || 5} out of 5">${renderStars(product.rating || 5)}</span>
          <span class="product-card__rating-text">${product.rating || 5} (${product.reviewCount || 0} reviews)</span>
        </div>
        <div class="product-card__actions">
          <button class="btn btn--primary btn--sm" disabled title="Ordering opens in Phase 4">
            🛒 Add to Cart
          </button>
          <button class="btn btn--secondary btn--sm" disabled title="Product details view opens in Phase 4">
            View Details
          </button>
        </div>
      </div>
    </article>
  `;
}


/**
 * Create HTML for a category card.
 * @param {Object} category
 * @returns {string} HTML string
 */
export function renderCategoryCard(category) {
  return `
    <div class="category-card reveal--scale" data-category="${category.id}">
      <div class="category-card__icon">${category.emoji}</div>
      <h3 class="category-card__name">${sanitizeHTML(category.name)}</h3>
      <p class="category-card__count">${category.count} products</p>
    </div>
  `;
}


/**
 * Create HTML for a testimonial card.
 * @param {Object} testimonial
 * @returns {string} HTML string
 */
export function renderTestimonialCard(testimonial) {
  return `
    <div class="testimonial-card reveal">
      <div class="testimonial-card__stars" aria-label="Rating: ${testimonial.rating} out of 5">
        ${'★'.repeat(testimonial.rating)}${'☆'.repeat(5 - testimonial.rating)}
      </div>
      <p class="testimonial-card__quote">"${sanitizeHTML(testimonial.quote)}"</p>
      <div class="testimonial-card__author">
        <div class="testimonial-card__avatar">${sanitizeHTML(testimonial.initials)}</div>
        <div>
          <p class="testimonial-card__name">${sanitizeHTML(testimonial.name)}</p>
          <p class="testimonial-card__location">${sanitizeHTML(testimonial.location)}</p>
        </div>
      </div>
    </div>
  `;
}


/**
 * Populate all storefront sections with real-time Firestore synchronization.
 * Called by app.js after DOM is ready.
 */
export function renderStorefront() {
  // 1. Render categories
  const categoriesContainer = document.getElementById('categories-grid');
  if (categoriesContainer) {
    categoriesContainer.innerHTML = CATEGORIES.map(renderCategoryCard).join('');
  }

  // 2. Render testimonials
  const testimonialsContainer = document.getElementById('testimonials-grid');
  if (testimonialsContainer) {
    testimonialsContainer.innerHTML = SAMPLE_TESTIMONIALS.map(renderTestimonialCard).join('');
  }

  // 3. Real-time Product Catalog subscription
  const productsContainer = document.getElementById('products-grid');
  const productsSectionSubtitle = document.querySelector('#products-section .section__subtitle');

  if (productsContainer) {
    // Show initial fallback/sample data while connecting to Firestore
    productsContainer.innerHTML = SAMPLE_PRODUCTS.map(renderProductCard).join('');

    // Subscribe to active products in Firestore
    subscribeToProducts((realProducts) => {
      if (realProducts && realProducts.length > 0) {
        // Real Firestore products exist! Render them with verified badges
        productsContainer.innerHTML = realProducts.map(renderProductCard).join('');
        if (productsSectionSubtitle) {
          productsSectionSubtitle.innerHTML = `
            Authentic cold-pressed cooking oils freshly updated from our shop.
          `;
        }
      } else {
        // No Firestore products published yet. Show demo products with honest notice.
        productsContainer.innerHTML = SAMPLE_PRODUCTS.map(renderProductCard).join('');
        if (productsSectionSubtitle) {
          productsSectionSubtitle.innerHTML = `
            Hand-selected premium oils loved by families across Tamil Nadu.
            <br /><em class="text-sm text-muted">(Demonstration Catalog: showing sample data. Add products in the Admin Portal to populate real inventory.)</em>
          `;
        }
      }

      // Ensure revealed classes apply
      document.querySelectorAll('#products-grid .reveal').forEach(el => {
        el.classList.add('reveal--visible');
      });
    }, { includeInactive: false });
  }
}
