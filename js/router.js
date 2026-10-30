/**
 * router.js — Client-Side Navigation Helpers (Stub)
 * 
 * Will provide lightweight page navigation utilities:
 * - Active link highlighting
 * - Auth-guarded route checks
 * - Role-based redirects
 * 
 * @todo Implement alongside multi-page build in Phase 2
 */

/**
 * Get the current page name from the URL.
 * @returns {string} e.g. "index", "catalog", "admin"
 */
export function getCurrentPage() {
  const path = window.location.pathname;
  const filename = path.split('/').pop() || 'index.html';
  return filename.replace('.html', '');
}

/** @todo Implement: Redirect if not authenticated */
export function requireAuth() {
  console.warn('[Router] requireAuth() is not yet implemented.');
}

/** @todo Implement: Redirect if not admin */
export function requireAdmin() {
  console.warn('[Router] requireAdmin() is not yet implemented.');
}
