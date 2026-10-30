/**
 * admin.js — Admin Dashboard Controller
 * 
 * Provides:
 * - Secure admin route authorization check
 * - Product listing with real-time Firestore sync
 * - Full Product CRUD with multi-size variant management
 * - Product image uploads to Firebase Storage
 * - Real orders inspection
 * - Low-stock alerts and inventory metrics
 */

import {
  getCurrentUser,
  getCurrentUserProfile,
  initAuthObserver,
  signInWithGoogle,
  signOut,
  isCurrentUserAdmin
} from './auth.js';

import {
  subscribeToProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  toggleProductStatus,
  getOrders,
  updateOrderStatus
} from './firestore.js';

import { formatPrice, sanitizeHTML, showToast, $, $$ } from './utils.js';


// ── State ──
let allProducts = [];
let filteredProducts = [];
let currentEditingProductId = null;
let selectedImageFile = null;
let pendingConfirmAction = null;
let activeTab = 'overview';


// ── DOM References ──
// Screens
const screenLoading       = $('#admin-loading-screen');
const screenUnauth        = $('#admin-unauth-screen');
const screenUnauthorized  = $('#admin-unauthorized-screen');
const screenDashboard     = $('#admin-dashboard-view');

// Header
const adminUserMenu       = $('#admin-user-menu');
const adminMenuTrigger    = $('#admin-menu-trigger');
const adminMenuDropdown   = $('#admin-menu-dropdown');
const adminUserAvatar     = $('#admin-user-avatar');
const adminUserName       = $('#admin-user-name');
const dropdownAdminName   = $('#dropdown-admin-name');
const dropdownAdminEmail  = $('#dropdown-admin-email');
const adminSignoutBtn     = $('#admin-signout-btn');
const adminSigninBtn      = $('#admin-signin-btn');
const unauthSignoutBtn    = $('#unauth-signout-btn');
const unauthUserEmail     = $('#unauth-user-email');
const unauthUserUid       = $('#unauth-user-uid');

// Tabs & Panels
const tabBtnOverview      = $('#tab-btn-overview');
const tabBtnProducts      = $('#tab-btn-products');
const tabBtnOrders        = $('#tab-btn-orders');
const panelOverview       = $('#panel-overview');
const panelProducts       = $('#panel-products');
const panelOrders         = $('#panel-orders');

// Topbar actions
const btnCreateProduct    = $('#btn-create-product');

// Metrics
const metricTotalProducts = $('#metric-total-products');
const metricActiveProducts= $('#metric-active-products');
const metricLowStock      = $('#metric-low-stock');
const metricTotalOrders   = $('#metric-total-orders');
const overviewLowStockList= $('#overview-low-stock-list');

// Filters
const filterSearch        = $('#filter-search');
const filterCategory      = $('#filter-category');
const filterStatus        = $('#filter-status');
const filterStock         = $('#filter-stock');
const productsCountBadge  = $('#products-count-badge');
const productsTableBody   = $('#products-table-body');
const productsEmptyState  = $('#products-empty-state');

// Orders
const ordersListContainer = $('#orders-list-container');
const ordersEmptyState    = $('#orders-empty-state');

// Product Modal
const productModal        = $('#product-modal');
const productModalTitle   = $('#product-modal-title');
const productModalClose   = $('#product-modal-close');
const btnCancelProduct    = $('#btn-cancel-product');
const productForm         = $('#product-form');
const formProductId       = $('#form-product-id');
const formName            = $('#form-name');
const formNameTamil       = $('#form-name-tamil');
const formCategory        = $('#form-category');
const formIsActive        = $('#form-is-active');
const formDescription     = $('#form-description');
const formCalories        = $('#form-calories');
const formTags            = $('#form-tags');
const formImageUrl        = $('#form-image-url');
const btnBrowseLocal      = $('#btn-browse-local');
const formImageFileHelper = $('#form-image-file-helper');
const imagePreviewContainer = $('#image-preview-container');
const imagePreviewImg     = $('#image-preview-img');
const imagePreviewName    = $('#image-preview-name');
const imagePreviewStatus  = $('#image-preview-status');
const btnClearImage       = $('#btn-clear-image');
const btnSaveProduct      = $('#btn-save-product');

// Variant Manager in Modal
const variantsContainer   = $('#variants-container');
const btnAddVariant       = $('#btn-add-variant');
const summaryTotalStock   = $('#summary-total-stock');
const summaryDisplayPrice = $('#summary-display-price');

// Confirmation Modal
const confirmModal        = $('#confirm-modal');
const confirmModalTitle   = $('#confirm-modal-title');
const confirmModalMsg     = $('#confirm-modal-msg');
const confirmModalClose   = $('#confirm-modal-close');
const confirmBtnCancel    = $('#confirm-btn-cancel');
const confirmBtnAction    = $('#confirm-btn-action');


// ═══════════════════════════════════════════════
// AUTHORIZATION & SCREEN ROUTING
// ═══════════════════════════════════════════════

/**
 * Show a single state screen in the admin portal.
 * @param {'loading'|'unauth'|'unauthorized'|'dashboard'} state
 */
function showAdminScreen(state) {
  screenLoading?.classList.toggle('hidden', state !== 'loading');
  screenUnauth?.classList.toggle('hidden', state !== 'unauth');
  screenUnauthorized?.classList.toggle('hidden', state !== 'unauthorized');
  screenDashboard?.classList.toggle('hidden', state !== 'dashboard');
}


/**
 * Validate current user permissions and route to appropriate admin view.
 */
async function verifyAndRenderAdmin() {
  const user = getCurrentUser();
  const profile = getCurrentUserProfile();

  if (!user) {
    showAdminScreen('unauth');
    adminUserMenu?.classList.add('hidden');
    return;
  }

  // Check if admin
  const hasAdminPrivileges = await isCurrentUserAdmin();

  if (!hasAdminPrivileges) {
    // Show Access Restricted screen with user context
    if (unauthUserEmail) unauthUserEmail.textContent = user.email || 'your account';
    if (unauthUserUid) unauthUserUid.textContent = user.uid;
    showAdminScreen('unauthorized');
    adminUserMenu?.classList.add('hidden');
    return;
  }

  // User is confirmed administrator
  showAdminScreen('dashboard');

  // Update header user menu
  adminUserMenu?.classList.remove('hidden');
  if (adminUserAvatar) adminUserAvatar.src = user.photoURL || '';
  if (adminUserName) adminUserName.textContent = sanitizeHTML(profile?.displayName || user.displayName || 'Admin');
  if (dropdownAdminName) dropdownAdminName.textContent = sanitizeHTML(profile?.displayName || user.displayName || 'Administrator');
  if (dropdownAdminEmail) dropdownAdminEmail.textContent = sanitizeHTML(user.email || '');

  // Start real-time product listener
  initProductsSubscription();

  // Load orders
  loadRealOrders();
}


// ═══════════════════════════════════════════════
// TABS SWITCHING
// ═══════════════════════════════════════════════

function switchTab(tab) {
  activeTab = tab;

  tabBtnOverview?.classList.toggle('is-active', tab === 'overview');
  tabBtnProducts?.classList.toggle('is-active', tab === 'products');
  tabBtnOrders?.classList.toggle('is-active', tab === 'orders');

  panelOverview?.classList.toggle('hidden', tab !== 'overview');
  panelProducts?.classList.toggle('hidden', tab !== 'products');
  panelOrders?.classList.toggle('hidden', tab !== 'orders');

  if (tab === 'orders') {
    loadRealOrders();
  }
}


// ═══════════════════════════════════════════════
// PRODUCT LISTING & REAL-TIME SYNC
// ═══════════════════════════════════════════════

let unsubscribeProducts = null;

function initProductsSubscription() {
  if (unsubscribeProducts) unsubscribeProducts();

  unsubscribeProducts = subscribeToProducts((products) => {
    allProducts = products;
    updateOverviewMetrics();
    applyProductFilters();
  }, { includeInactive: true });
}


/**
 * Calculate and update dashboard overview metrics.
 */
function updateOverviewMetrics() {
  const total = allProducts.length;
  const active = allProducts.filter(p => p.isActive).length;

  // Count products where any variant or total stock is <= 10
  const lowStockProducts = allProducts.filter(p => {
    if (p.variants && p.variants.length > 0) {
      return p.variants.some(v => v.stock <= 10);
    }
    return (p.stock || 0) <= 10;
  });

  if (metricTotalProducts) metricTotalProducts.textContent = total;
  if (metricActiveProducts) metricActiveProducts.textContent = active;
  if (metricLowStock) metricLowStock.textContent = lowStockProducts.length;

  // Render Low Stock list in Overview tab
  if (overviewLowStockList) {
    if (lowStockProducts.length === 0) {
      overviewLowStockList.innerHTML = `
        <p class="text-sm text-secondary" style="padding: var(--space-2) 0;">
          ✅ All product variants currently have healthy inventory levels (&gt; 10 units).
        </p>
      `;
    } else {
      overviewLowStockList.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: var(--space-3);">
          ${lowStockProducts.map(p => {
            const lowVariants = (p.variants || []).filter(v => v.stock <= 10);
            const variantNotes = lowVariants.map(v => `${v.size}: ${v.stock} left`).join(', ') || `Stock: ${p.stock}`;
            return `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: var(--space-3); background: var(--color-gray-50); border-radius: var(--radius-md); border-left: 3px solid var(--color-rich-amber);">
                <div>
                  <strong class="text-sm">${sanitizeHTML(p.name)}</strong>
                  <span class="text-xs text-muted" style="margin-left: 8px;">(${sanitizeHTML(p.category)})</span>
                  <div class="text-xs" style="color: var(--color-rich-amber); margin-top: 2px;">
                    ${sanitizeHTML(variantNotes)}
                  </div>
                </div>
                <button class="btn btn--secondary btn--sm" data-edit-id="${p.id}">
                  Restock / Edit
                </button>
              </div>
            `;
          }).join('')}
        </div>
      `;

      // Attach edit clicks in low-stock list
      overviewLowStockList.querySelectorAll('[data-edit-id]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-edit-id');
          const product = allProducts.find(p => p.id === id);
          if (product) openProductModal(product);
        });
      });
    }
  }
}


/**
 * Filter products based on search, category, status, and stock level.
 */
function applyProductFilters() {
  const query = (filterSearch?.value || '').toLowerCase().trim();
  const cat = filterCategory?.value || '';
  const status = filterStatus?.value || 'all';
  const stock = filterStock?.value || 'all';

  filteredProducts = allProducts.filter(p => {
    // Search filter
    if (query) {
      const matchName = (p.name || '').toLowerCase().includes(query);
      const matchTamil = (p.nameTamil || '').toLowerCase().includes(query);
      const matchCat = (p.category || '').toLowerCase().includes(query);
      const matchSku = (p.variants || []).some(v => (v.sku || '').toLowerCase().includes(query));
      if (!matchName && !matchTamil && !matchCat && !matchSku) return false;
    }

    // Category filter
    if (cat && p.category !== cat) return false;

    // Status filter
    if (status === 'active' && !p.isActive) return false;
    if (status === 'inactive' && p.isActive) return false;

    // Stock filter
    if (stock === 'low' && (p.stock || 0) > 10) return false;
    if (stock === 'out' && (p.stock || 0) > 0) return false;

    return true;
  });

  renderProductsTable();
}


/**
 * Render the filtered products table.
 */
function renderProductsTable() {
  if (!productsTableBody) return;

  if (productsCountBadge) {
    productsCountBadge.textContent = `Showing ${filteredProducts.length} of ${allProducts.length} products`;
  }

  if (filteredProducts.length === 0) {
    productsTableBody.innerHTML = '';
    productsEmptyState?.classList.remove('hidden');
    return;
  }

  productsEmptyState?.classList.add('hidden');

  productsTableBody.innerHTML = filteredProducts.map(p => {
    const hasImage = p.imageURL || (p.imageURLs && p.imageURLs[0]);
    const thumbHTML = hasImage
      ? `<img src="${sanitizeHTML(hasImage)}" class="product-thumb" alt="${sanitizeHTML(p.name)}" onerror="this.onerror=null; this.src='assets/images/placeholders/product-placeholder.webp';" />`
      : `<img src="assets/images/placeholders/product-placeholder.webp" class="product-thumb" alt="${sanitizeHTML(p.name)}" />`;

    // Variants display
    const variants = p.variants || [];
    const sizesBadge = variants.length > 0
      ? variants.map(v => `<span class="product-card__badge" style="background: var(--color-gray-100); color: var(--color-deep-olive); margin: 2px 2px 2px 0;">${sanitizeHTML(v.size)} (${v.stock})</span>`).join('')
      : `<span class="text-xs text-muted">${sanitizeHTML(p.unit || '1L')}</span>`;

    // Price range or display price
    let priceText = formatPrice(p.price || 0);
    if (variants.length > 1) {
      const prices = variants.map(v => v.discountPrice || v.price);
      const minP = Math.min(...prices);
      const maxP = Math.max(...prices);
      priceText = minP === maxP ? formatPrice(minP) : `${formatPrice(minP)} – ${formatPrice(maxP)}`;
    }

    // Stock status
    const totalStock = p.stock !== undefined ? p.stock : variants.reduce((s, v) => s + v.stock, 0);
    let stockBadge = `<span class="status-badge" style="background: rgba(74, 124, 63, 0.12); color: var(--color-leaf-green);">${totalStock} in stock</span>`;
    if (totalStock === 0) {
      stockBadge = `<span class="status-badge status-badge--out-of-stock">Out of stock</span>`;
    } else if (totalStock <= 10) {
      stockBadge = `<span class="status-badge status-badge--low-stock">Low (${totalStock})</span>`;
    }

    // Active status badge
    const activeBadge = p.isActive
      ? `<span class="status-badge status-badge--active">Active</span>`
      : `<span class="status-badge status-badge--inactive">Inactive</span>`;

    return `
      <tr data-product-row-id="${p.id}">
        <td>${thumbHTML}</td>
        <td>
          <strong class="text-sm" style="color: var(--color-deep-olive);">${sanitizeHTML(p.name)}</strong>
          ${p.nameTamil ? `<div class="text-xs text-muted" style="font-family: var(--font-tamil);">${sanitizeHTML(p.nameTamil)}</div>` : ''}
        </td>
        <td>
          <span class="text-xs font-semibold" style="text-transform: capitalize; color: var(--color-gold-dark);">${sanitizeHTML(p.category || 'sesame')}</span>
        </td>
        <td style="max-width: 220px;">${sizesBadge}</td>
        <td><strong>${priceText}</strong></td>
        <td>${stockBadge}</td>
        <td>${activeBadge}</td>
        <td style="text-align: right;">
          <div class="actions-cell" style="justify-content: flex-end;">
            <button class="btn btn--secondary btn--sm" data-action="edit" data-id="${p.id}" title="Edit product">
              ✏️ Edit
            </button>
            <button class="btn btn--ghost btn--sm" data-action="toggle" data-id="${p.id}" data-active="${p.isActive}" title="${p.isActive ? 'Deactivate product' : 'Activate product'}">
              ${p.isActive ? 'Hide' : 'Show'}
            </button>
            <button class="btn btn--danger btn--sm" data-action="delete" data-id="${p.id}" title="Delete product">
              🗑️
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Wire up row action buttons
  productsTableBody.querySelectorAll('[data-action]').forEach(btn => {
    const action = btn.getAttribute('data-action');
    const id = btn.getAttribute('data-id');
    const product = allProducts.find(p => p.id === id);

    if (action === 'edit') {
      btn.addEventListener('click', () => {
        if (product) openProductModal(product);
      });
    } else if (action === 'toggle') {
      const isCurrentlyActive = btn.getAttribute('data-active') === 'true';
      btn.addEventListener('click', () => {
        const actionLabel = isCurrentlyActive ? 'deactivate' : 'activate';
        openConfirmModal(
          `${isCurrentlyActive ? 'Deactivate' : 'Activate'} Product?`,
          `Are you sure you want to ${actionLabel} "${product?.name || 'this product'}"? ${isCurrentlyActive ? 'It will be hidden from customer view.' : 'It will appear on the public storefront.'}`,
          async () => {
            try {
              await toggleProductStatus(id, !isCurrentlyActive);
              showToast(`Product ${isCurrentlyActive ? 'deactivated' : 'activated'} successfully.`, 'success');
            } catch (err) {
              showToast(err.message, 'error');
            }
          }
        );
      });
    } else if (action === 'delete') {
      btn.addEventListener('click', () => {
        openConfirmModal(
          `Delete Product?`,
          `Are you sure you want to permanently delete "${product?.name || 'this product'}"? This action cannot be undone.`,
          async () => {
            try {
              await deleteProduct(id);
              showToast('Product deleted from Firestore.', 'info');
            } catch (err) {
              showToast(err.message, 'error');
            }
          }
        );
      });
    }
  });
}


// ═══════════════════════════════════════════════
// PRODUCT MODAL & VARIANT MANAGEMENT
// ═══════════════════════════════════════════════

/**
 * Open the product modal for either creating a new product or editing an existing one.
 * @param {Object|null} product - If provided, opens in Edit mode. If null, opens in Create mode.
 */
function openProductModal(product = null) {
  currentEditingProductId = product ? product.id : null;

  // Set modal title
  if (productModalTitle) {
    productModalTitle.textContent = product ? `Edit Product: ${product.name}` : 'Add New Product';
  }

  // Populate form fields
  if (formProductId) formProductId.value = product ? product.id : '';
  if (formName) formName.value = product ? product.name : '';
  if (formNameTamil) formNameTamil.value = product?.nameTamil || '';
  if (formCategory) formCategory.value = product?.category || 'sesame';
  if (formIsActive) formIsActive.checked = product ? product.isActive : true;
  if (formDescription) formDescription.value = product?.description || '';
  if (formCalories) formCalories.value = product?.nutritionInfo?.calories || '';
  if (formTags) formTags.value = Array.isArray(product?.tags) ? product.tags.join(', ') : '';
  
  const currentImg = product?.imageURL || (product?.imageURLs && product.imageURLs[0]) || '';
  if (formImageUrl) formImageUrl.value = currentImg;

  // Image preview
  if (currentImg) {
    showImagePreview(currentImg, currentImg);
  } else {
    showImagePreview('assets/images/placeholders/product-placeholder.webp', 'Default placeholder');
  }

  // Populate variants
  if (variantsContainer) {
    variantsContainer.innerHTML = '';
    const variants = (product && Array.isArray(product.variants) && product.variants.length > 0)
      ? product.variants
      : [
          { size: '500ml', sku: 'SES-500ML', price: 230, discountPrice: 199, stock: 40, isDefault: false },
          { size: '1L', sku: 'SES-1L', price: 450, discountPrice: 399, stock: 50, isDefault: true },
          { size: '5L', sku: 'SES-5L', price: 2100, discountPrice: 1899, stock: 20, isDefault: false }
        ];

    variants.forEach(v => addVariantRow(v));
    updateVariantSummary();
  }

  // Open modal
  productModal?.classList.add('is-open');
  productModal?.setAttribute('aria-hidden', 'false');
}


function closeProductModal() {
  productModal?.classList.remove('is-open');
  productModal?.setAttribute('aria-hidden', 'true');
  currentEditingProductId = null;
  selectedImageFile = null;
  resetImagePreview();
}


/**
 * Add a dynamic variant row to the variant management section.
 */
function addVariantRow(data = {}) {
  if (!variantsContainer) return;

  const row = document.createElement('div');
  row.classList.add('variant-row');

  const rowId = 'variant_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);

  row.innerHTML = `
    <div>
      <input type="text" class="variant-size" placeholder="e.g. 1L" value="${sanitizeHTML(data.size || '1L')}" required />
    </div>
    <div>
      <input type="text" class="variant-sku" placeholder="SKU" value="${sanitizeHTML(data.sku || '')}" />
    </div>
    <div>
      <input type="number" class="variant-price" placeholder="Price" min="0" step="1" value="${data.price !== undefined ? data.price : ''}" required />
    </div>
    <div>
      <input type="number" class="variant-discount" placeholder="Discount" min="0" step="1" value="${data.discountPrice || ''}" />
    </div>
    <div>
      <input type="number" class="variant-stock" placeholder="Stock" min="0" step="1" value="${data.stock !== undefined ? data.stock : 10}" required />
    </div>
    <div style="text-align: center;">
      <input type="radio" name="default_variant" class="variant-default" ${data.isDefault ? 'checked' : ''} style="cursor: pointer;" />
    </div>
    <div>
      <button type="button" class="btn btn--ghost btn--sm btn-delete-variant" style="color: var(--color-error); padding: 2px 6px;" title="Remove variant">✕</button>
    </div>
  `;

  // Attach delete listener
  row.querySelector('.btn-delete-variant').addEventListener('click', () => {
    if (variantsContainer.querySelectorAll('.variant-row').length <= 1) {
      showToast('A product must have at least one size variant.', 'warning');
      return;
    }
    row.remove();
    // Ensure at least one radio is checked
    const checked = variantsContainer.querySelector('.variant-default:checked');
    if (!checked) {
      const firstRadio = variantsContainer.querySelector('.variant-default');
      if (firstRadio) firstRadio.checked = true;
    }
    updateVariantSummary();
  });

  // Attach change listeners for live stock and price recalculations
  row.querySelectorAll('input').forEach(input => {
    input.addEventListener('input', updateVariantSummary);
    input.addEventListener('change', updateVariantSummary);
  });

  variantsContainer.appendChild(row);
  updateVariantSummary();
}


/**
 * Read current variants inputs and recalculate total inventory and display price.
 */
function updateVariantSummary() {
  if (!variantsContainer) return;

  const rows = variantsContainer.querySelectorAll('.variant-row');
  let totalStock = 0;
  let primaryPrice = 0;

  rows.forEach(row => {
    const stockVal = parseInt(row.querySelector('.variant-stock')?.value, 10) || 0;
    const priceVal = parseFloat(row.querySelector('.variant-price')?.value) || 0;
    const discountVal = parseFloat(row.querySelector('.variant-discount')?.value) || 0;
    const isDefault = row.querySelector('.variant-default')?.checked;

    totalStock += Math.max(0, stockVal);

    if (isDefault) {
      primaryPrice = discountVal > 0 ? discountVal : priceVal;
    }
  });

  if (summaryTotalStock) summaryTotalStock.textContent = totalStock;
  if (summaryDisplayPrice) summaryDisplayPrice.textContent = formatPrice(primaryPrice);
}


/**
 * Extract variant objects array from the variant rows.
 */
function getVariantsFromForm() {
  if (!variantsContainer) return [];

  const rows = variantsContainer.querySelectorAll('.variant-row');
  const variants = [];

  rows.forEach((row, i) => {
    const size = (row.querySelector('.variant-size')?.value || '').trim();
    const sku = (row.querySelector('.variant-sku')?.value || '').trim().toUpperCase();
    const price = parseFloat(row.querySelector('.variant-price')?.value) || 0;
    const discountPrice = parseFloat(row.querySelector('.variant-discount')?.value) || null;
    const stock = parseInt(row.querySelector('.variant-stock')?.value, 10) || 0;
    const isDefault = row.querySelector('.variant-default')?.checked || false;

    if (size && price >= 0) {
      variants.push({
        size,
        sku: sku || `OIL-${size.toUpperCase()}`,
        price,
        discountPrice: (discountPrice && discountPrice > 0) ? discountPrice : null,
        stock: Math.max(0, stock),
        isDefault
      });
    }
  });

  // Ensure one default variant exists
  if (variants.length > 0 && !variants.some(v => v.isDefault)) {
    variants[0].isDefault = true;
  }

  return variants;
}


// ═══════════════════════════════════════════════
// LOCAL PRODUCT IMAGE ASSET PREVIEW & SELECTION
// ═══════════════════════════════════════════════

const FALLBACK_PLACEHOLDER = 'assets/images/placeholders/product-placeholder.webp';

function showImagePreview(src, label) {
  if (imagePreviewImg) {
    imagePreviewImg.src = src || FALLBACK_PLACEHOLDER;
  }
  if (imagePreviewName) {
    imagePreviewName.textContent = label || src || FALLBACK_PLACEHOLDER;
  }
}

function resetImagePreview() {
  if (formImageUrl) formImageUrl.value = '';
  showImagePreview(FALLBACK_PLACEHOLDER, 'Default placeholder');
}

function setupImageControls() {
  // Live typing/pasting of local image path
  formImageUrl?.addEventListener('input', (e) => {
    const val = (e.target.value || '').trim();
    if (val) {
      showImagePreview(val, val);
    } else {
      showImagePreview(FALLBACK_PLACEHOLDER, 'Default placeholder');
    }
  });

  // Quick preset buttons for sample local product images
  $$('.btn-preset-image').forEach(btn => {
    btn.addEventListener('click', () => {
      const path = btn.getAttribute('data-path');
      if (formImageUrl && path) {
        formImageUrl.value = path;
        showImagePreview(path, path);
      }
    });
  });

  // Pick local file helper: automatically extracts filename and sets relative path
  btnBrowseLocal?.addEventListener('click', () => {
    formImageFileHelper?.click();
  });

  formImageFileHelper?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const relativePath = `assets/images/products/${cleanName}`;

    if (formImageUrl) {
      formImageUrl.value = relativePath;
    }

    // Use FileReader for immediate preview
    const reader = new FileReader();
    reader.onload = (readEvent) => {
      showImagePreview(readEvent.target.result, `${relativePath} (${(file.size / 1024).toFixed(1)} KB)`);
    };
    reader.readAsDataURL(file);

    showToast(`Path set to "${relativePath}". Add "${cleanName}" into assets/images/products/ before deploying.`, 'info', 5000);
  });

  // Clear image button
  btnClearImage?.addEventListener('click', () => {
    resetImagePreview();
  });
}


// ═══════════════════════════════════════════════
// PRODUCT FORM SUBMISSION
// ═══════════════════════════════════════════════

async function handleProductFormSubmit(e) {
  e.preventDefault();

  const name = (formName?.value || '').trim();
  const category = (formCategory?.value || 'sesame').trim();
  const variants = getVariantsFromForm();

  if (!name) {
    showToast('Please enter a product name.', 'warning');
    formName?.focus();
    return;
  }

  if (variants.length === 0) {
    showToast('Please add at least one valid size variant with a price.', 'warning');
    return;
  }

  // Disable button while processing
  if (btnSaveProduct) {
    btnSaveProduct.disabled = true;
    btnSaveProduct.textContent = 'Saving Product...';
  }

  try {
    let finalImageUrl = (formImageUrl?.value || '').trim();
    if (!finalImageUrl) {
      finalImageUrl = FALLBACK_PLACEHOLDER;
    }

    const tagsArray = (formTags?.value || '')
      .split(',')
      .map(t => t.trim().toLowerCase())
      .filter(Boolean);

    const productPayload = {
      name: name,
      nameTamil: (formNameTamil?.value || '').trim(),
      category: category,
      isActive: Boolean(formIsActive?.checked),
      description: (formDescription?.value || '').trim(),
      imageURL: finalImageUrl,
      imageURLs: finalImageUrl ? [finalImageUrl] : [],
      variants: variants,
      tags: tagsArray,
      nutritionInfo: {
        calories: (formCalories?.value || '884 kcal/100ml').trim(),
        fat: '100g',
        saturatedFat: '14g'
      }
    };

    if (currentEditingProductId) {
      // Update existing product
      await updateProduct(currentEditingProductId, productPayload);
      showToast('Product updated successfully in Firestore.', 'success');
    } else {
      // Create new product
      await createProduct(productPayload);
      showToast('New product created successfully.', 'success');
    }

    closeProductModal();
  } catch (err) {
    console.error('[Admin] Error saving product:', err);
    showToast(err.message || 'Failed to save product.', 'error');
  } finally {
    if (btnSaveProduct) {
      btnSaveProduct.disabled = false;
      btnSaveProduct.textContent = 'Save Product';
    }
  }
}


// ═══════════════════════════════════════════════
// REAL ORDERS INSPECTION
// ═══════════════════════════════════════════════

async function loadRealOrders() {
  if (!ordersListContainer) return;

  try {
    const orders = await getOrders();

    if (metricTotalOrders) {
      metricTotalOrders.textContent = orders.length;
    }

    if (orders.length === 0) {
      ordersListContainer.innerHTML = '';
      ordersEmptyState?.classList.remove('hidden');
      return;
    }

    ordersEmptyState?.classList.add('hidden');

    ordersListContainer.innerHTML = orders.map(ord => {
      const orderDate = ord.createdAt?.toDate
        ? ord.createdAt.toDate().toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : 'Recent';

      const itemsSummary = (ord.items || []).map(i => `${sanitizeHTML(i.name)} (${i.size || '1L'}) × ${i.quantity}`).join(', ');

      return `
        <div class="order-card" data-order-id="${ord.id}">
          <div class="order-card__header">
            <div>
              <span class="order-card__id">Order #${ord.id.slice(0, 8)}</span>
              <span class="text-xs text-muted" style="margin-left: 12px;">${orderDate}</span>
            </div>
            <div>
              <select class="admin-select order-status-select" data-order-id="${ord.id}" style="font-size: var(--text-xs); padding: 4px 8px; min-height: auto;">
                <option value="placed" ${ord.status === 'placed' ? 'selected' : ''}>Placed</option>
                <option value="confirmed" ${ord.status === 'confirmed' ? 'selected' : ''}>Confirmed</option>
                <option value="shipped" ${ord.status === 'shipped' ? 'selected' : ''}>Shipped</option>
                <option value="delivered" ${ord.status === 'delivered' ? 'selected' : ''}>Delivered</option>
                <option value="cancelled" ${ord.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
              </select>
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; flex-wrap: wrap; gap: var(--space-4);">
            <div>
              <p class="text-sm"><strong>Customer:</strong> ${sanitizeHTML(ord.userEmail || ord.userName || 'Customer')}</p>
              <p class="text-xs text-secondary" style="margin-top: 4px;"><strong>Items:</strong> ${itemsSummary || '—'}</p>
            </div>
            <div style="text-align: right;">
              <span class="text-sm font-semibold">Total: ${formatPrice(ord.total || ord.subtotal || 0)}</span>
              <div class="text-xs text-muted">${ord.paymentStatus ? `Payment: ${ord.paymentStatus}` : ''}</div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Wire up order status changes
    ordersListContainer.querySelectorAll('.order-status-select').forEach(sel => {
      sel.addEventListener('change', async (e) => {
        const orderId = sel.getAttribute('data-order-id');
        const newStatus = e.target.value;
        try {
          await updateOrderStatus(orderId, newStatus);
          showToast(`Order status updated to "${newStatus}".`, 'success');
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

  } catch (err) {
    console.warn('[Admin] Note loading orders:', err.message);
  }
}


// ═══════════════════════════════════════════════
// CONFIRMATION MODAL HELPER
// ═══════════════════════════════════════════════

function openConfirmModal(title, message, onConfirm) {
  if (confirmModalTitle) confirmModalTitle.textContent = title;
  if (confirmModalMsg) confirmModalMsg.textContent = message;
  pendingConfirmAction = onConfirm;

  confirmModal?.classList.add('is-open');
  confirmModal?.setAttribute('aria-hidden', 'false');
}

function closeConfirmModal() {
  confirmModal?.classList.remove('is-open');
  confirmModal?.setAttribute('aria-hidden', 'true');
  pendingConfirmAction = null;
}


// ═══════════════════════════════════════════════
// EVENT LISTENERS INITIALIZATION
// ═══════════════════════════════════════════════

function setupEventListeners() {
  // Sign in & Sign out
  adminSigninBtn?.addEventListener('click', () => signInWithGoogle());
  adminSignoutBtn?.addEventListener('click', () => signOut());
  unauthSignoutBtn?.addEventListener('click', () => signOut());

  // User menu toggle
  adminMenuTrigger?.addEventListener('click', (e) => {
    e.stopPropagation();
    adminMenuDropdown?.classList.toggle('is-open');
  });

  document.addEventListener('click', (e) => {
    if (adminMenuDropdown && !adminUserMenu?.contains(e.target)) {
      adminMenuDropdown.classList.remove('is-open');
    }
  });

  // Tab switching
  tabBtnOverview?.addEventListener('click', () => switchTab('overview'));
  tabBtnProducts?.addEventListener('click', () => switchTab('products'));
  tabBtnOrders?.addEventListener('click', () => switchTab('orders'));

  // Product filters
  filterSearch?.addEventListener('input', applyProductFilters);
  filterCategory?.addEventListener('change', applyProductFilters);
  filterStatus?.addEventListener('change', applyProductFilters);
  filterStock?.addEventListener('change', applyProductFilters);

  // Open create product modal
  btnCreateProduct?.addEventListener('click', () => {
    openProductModal(null);
  });

  // Product modal close
  productModalClose?.addEventListener('click', closeProductModal);
  btnCancelProduct?.addEventListener('click', closeProductModal);

  // Variant manager: add variant row
  btnAddVariant?.addEventListener('click', () => {
    addVariantRow();
  });

  // Local image asset controls setup
  setupImageControls();

  // Product form submit
  productForm?.addEventListener('submit', handleProductFormSubmit);

  // Confirm modal events
  confirmModalClose?.addEventListener('click', closeConfirmModal);
  confirmBtnCancel?.addEventListener('click', closeConfirmModal);
  confirmBtnAction?.addEventListener('click', async () => {
    if (pendingConfirmAction) {
      await pendingConfirmAction();
    }
    closeConfirmModal();
  });

  // Close modals on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (confirmModal?.classList.contains('is-open')) closeConfirmModal();
      else if (productModal?.classList.contains('is-open')) closeProductModal();
      else if (adminMenuDropdown?.classList.contains('is-open')) adminMenuDropdown.classList.remove('is-open');
    }
  });
}


// ═══════════════════════════════════════════════
// BOOTSTRAP
// ═══════════════════════════════════════════════

export function initAdminDashboard() {
  setupEventListeners();

  // Initialize auth state observer
  initAuthObserver(async () => {
    await verifyAndRenderAdmin();
  });
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdminDashboard);
} else {
  initAdminDashboard();
}
