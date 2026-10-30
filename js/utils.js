/**
 * utils.js — Shared Utilities
 * 
 * Helper functions used across the application:
 * formatting, DOM helpers, toast notifications, etc.
 */


/**
 * Format a number as Indian Rupees (₹).
 * @param {number} amount
 * @returns {string} e.g. "₹1,299"
 */
export function formatPrice(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
}


/**
 * Format a Firestore Timestamp or Date to a human-readable string.
 * @param {Object|Date} timestamp - Firestore Timestamp or JS Date.
 * @returns {string}
 */
export function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(date);
}


/**
 * Debounce a function — delays execution until the caller stops invoking
 * for `delay` milliseconds.
 * 
 * @param {Function} fn
 * @param {number} delay - Milliseconds
 * @returns {Function}
 */
export function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}


/**
 * Sanitize a string for safe HTML insertion (prevents XSS).
 * @param {string} str
 * @returns {string}
 */
export function sanitizeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}


/**
 * Generate a short pseudo-random ID (not cryptographically secure).
 * Useful for DOM element IDs and toast keys.
 * @returns {string}
 */
export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}


// ═══════════════════════════════════════════════
// Toast Notification System
// ═══════════════════════════════════════════════

let toastContainer = null;

/**
 * Ensure the toast container exists in the DOM.
 */
function ensureToastContainer() {
  if (toastContainer && document.body.contains(toastContainer)) return;

  toastContainer = document.createElement('div');
  toastContainer.classList.add('toast-container');
  toastContainer.setAttribute('aria-live', 'polite');
  toastContainer.setAttribute('role', 'status');
  document.body.appendChild(toastContainer);
}


/**
 * Show a toast notification.
 * 
 * @param {string} message - The message to display.
 * @param {'success'|'error'|'info'|'warning'} type - Toast type.
 * @param {number} duration - Auto-dismiss in milliseconds (default 4000).
 */
export function showToast(message, type = 'info', duration = 4000) {
  ensureToastContainer();

  const icons = {
    success: '✓',
    error: '✕',
    info: 'ℹ',
    warning: '⚠'
  };

  const toast = document.createElement('div');
  toast.classList.add('toast', `toast--${type}`);
  toast.setAttribute('role', 'alert');
  toast.innerHTML = `
    <span>${icons[type] || 'ℹ'}</span>
    <span>${sanitizeHTML(message)}</span>
    <button class="toast__dismiss" aria-label="Dismiss">&times;</button>
  `;

  // Dismiss on click
  toast.querySelector('.toast__dismiss').addEventListener('click', () => {
    dismissToast(toast);
  });

  toastContainer.appendChild(toast);

  // Auto-dismiss
  if (duration > 0) {
    setTimeout(() => dismissToast(toast), duration);
  }
}


/**
 * Remove a toast with a fade-out animation.
 * @param {HTMLElement} toast
 */
function dismissToast(toast) {
  if (!toast || !toast.parentNode) return;

  toast.style.opacity = '0';
  toast.style.transform = 'translateY(12px) scale(0.96)';
  toast.style.transition = 'opacity 200ms ease, transform 200ms ease';

  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 200);
}


// ═══════════════════════════════════════════════
// DOM Helpers
// ═══════════════════════════════════════════════

/**
 * Shorthand for querySelector.
 * @param {string} selector
 * @param {Element} parent
 * @returns {Element|null}
 */
export function $(selector, parent = document) {
  return parent.querySelector(selector);
}

/**
 * Shorthand for querySelectorAll (returns real Array).
 * @param {string} selector
 * @param {Element} parent
 * @returns {Element[]}
 */
export function $$(selector, parent = document) {
  return Array.from(parent.querySelectorAll(selector));
}
