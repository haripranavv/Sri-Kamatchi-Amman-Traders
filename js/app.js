/**
 * app.js — Main Application Entry Point
 * 
 * Orchestrates the app lifecycle:
 * 1. Check Firebase configuration
 * 2. Render storefront components (hero, categories, products, etc.)
 * 3. Initialize auth observer & update navbar / profile
 * 4. Trigger GSAP animations
 * 5. Wire up event handlers, modals, and dropdowns
 */

import { isFirebaseConfigMissing } from './firebase-config.js';
import { initAuthObserver, signInWithGoogle, signOut, onAuthChange, getCurrentUser, getCurrentUserProfile } from './auth.js';
import { sanitizeHTML, $ } from './utils.js';
import { renderStorefront } from './home.js';
import { initAnimations } from './animations.js';


// ── DOM References ──
const appRoot            = $('#app');
const loadingScreen      = $('#loading-screen');
const configScreen       = $('#config-screen');
const welcomeScreen      = $('#welcome-screen');
const storefrontView     = $('#storefront-view');

// Navbar elements
const navAuthActions     = $('#nav-auth-actions');
const signInBtn          = $('#nav-sign-in-btn');
const userMenuContainer  = $('#user-menu-container');
const userMenuTrigger    = $('#user-menu-trigger');
const userMenuDropdown   = $('#user-menu-dropdown');
const userAvatar         = $('#user-avatar');
const userName           = $('#user-name');
const userEmail          = $('#user-email');
const signOutBtn         = $('#sign-out-btn');
const signInBtnWelcome   = $('#sign-in-btn-welcome');
const userMenuProfileBtn = $('#user-menu-profile-btn');

// Profile Modal elements
const profileModal       = $('#profile-modal');
const profileModalClose  = $('#profile-modal-close');
const profileModalContent= $('#profile-modal-content');


// ── App State Screens ──

/**
 * Show exactly one app screen, hide the rest.
 * @param {'loading'|'config'|'welcome'|'storefront'} screen
 */
function showScreen(screen) {
  loadingScreen?.classList.toggle('hidden', screen !== 'loading');
  configScreen?.classList.toggle('hidden', screen !== 'config');
  welcomeScreen?.classList.toggle('hidden', screen !== 'welcome');
  storefrontView?.classList.toggle('hidden', screen !== 'storefront');
}


/**
 * Update the navbar to reflect auth state.
 * @param {Object|null} user
 * @param {Object|null} profile
 */
function updateNavbar(user, profile) {
  if (user) {
    signInBtn?.classList.add('hidden');
    userMenuContainer?.classList.remove('hidden');

    // Set user info
    if (userAvatar) {
      userAvatar.src = user.photoURL || '';
      userAvatar.alt = user.displayName || 'User avatar';
    }
    if (userName) userName.textContent = sanitizeHTML(profile?.displayName || user.displayName || 'User');
    if (userEmail) userEmail.textContent = sanitizeHTML(user.email || '');

    // Show role badge and admin portal link if admin
    const roleBadge = $('#user-role-badge');
    const adminLink = $('#user-menu-admin-link');
    if (profile?.role === 'admin') {
      if (roleBadge) {
        roleBadge.textContent = 'Admin';
        roleBadge.classList.remove('hidden');
      }
      if (adminLink) adminLink.classList.remove('hidden');
    } else {
      if (roleBadge) roleBadge.classList.add('hidden');
      if (adminLink) adminLink.classList.add('hidden');
    }
  } else {
    signInBtn?.classList.remove('hidden');
    userMenuContainer?.classList.add('hidden');
    const adminLink = $('#user-menu-admin-link');
    if (adminLink) adminLink.classList.add('hidden');
  }
}


/**
 * Render the profile modal content.
 * Preserves the ability to inspect user account, role, UID, and creation date.
 * @param {Object|null} user
 * @param {Object|null} profile
 */
function renderProfileModal(user, profile) {
  if (!profileModalContent) return;

  if (!user) {
    profileModalContent.innerHTML = `
      <p class="text-sm text-secondary" style="padding: var(--space-4) 0; text-align: center;">
        Please sign in to view your profile details.
      </p>
    `;
    return;
  }

  const role = profile?.role || 'customer';
  const memberSince = profile?.createdAt?.toDate
    ? profile.createdAt.toDate().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'Just now';

  profileModalContent.innerHTML = `
    <div style="display: flex; align-items: center; gap: var(--space-4); margin-bottom: var(--space-6); padding-bottom: var(--space-4); border-bottom: 1px solid var(--color-gray-200);">
      <img 
        class="avatar avatar--lg" 
        src="${sanitizeHTML(user.photoURL || '')}" 
        alt="${sanitizeHTML(user.displayName || 'User')}" 
      />
      <div>
        <h3 style="font-family: var(--font-heading); font-size: var(--text-lg); font-weight: 700; color: var(--color-text-primary);">
          ${sanitizeHTML(profile?.displayName || user.displayName || 'User')}
        </h3>
        <span class="product-card__badge ${role === 'admin' ? 'product-card__badge--sale' : 'product-card__badge--cold-pressed'}" style="margin-top: 6px; display: inline-block;">
          Role: ${sanitizeHTML(role)}
        </span>
      </div>
    </div>

    <div style="display: flex; flex-direction: column; gap: var(--space-4);">
      <div style="display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-4);">
        <span class="text-sm font-semibold text-secondary" style="font-weight: 600;">Email</span>
        <span class="text-sm" style="word-break: break-all;">${sanitizeHTML(user.email || '—')}</span>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-4);">
        <span class="text-sm font-semibold text-secondary" style="font-weight: 600;">Account ID (UID)</span>
        <span class="text-xs text-muted" style="font-family: monospace; word-break: break-all;">${sanitizeHTML(user.uid)}</span>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-4);">
        <span class="text-sm font-semibold text-secondary" style="font-weight: 600;">Member Since</span>
        <span class="text-sm">${memberSince}</span>
      </div>

      ${role === 'admin' ? `
        <div style="margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--color-gray-200); text-align: center;">
          <a href="admin.html" class="btn btn--primary btn--sm" style="width: 100%;">
            ⚙️ Open Admin Portal
          </a>
        </div>
      ` : ''}
    </div>
  `;
}


/**
 * Open the user profile modal.
 */
function openProfileModal() {
  const user = getCurrentUser();
  const profile = getCurrentUserProfile();
  renderProfileModal(user, profile);
  profileModal?.classList.add('is-open');
  profileModal?.setAttribute('aria-hidden', 'false');
  userMenuDropdown?.classList.remove('is-open');
}

/**
 * Close the user profile modal.
 */
function closeProfileModal() {
  profileModal?.classList.remove('is-open');
  profileModal?.setAttribute('aria-hidden', 'true');
}


// ── Event Handlers ──

function setupEventListeners() {
  // Sign in button (navbar)
  signInBtn?.addEventListener('click', () => {
    signInWithGoogle();
  });

  // Sign in button (welcome screen)
  signInBtnWelcome?.addEventListener('click', () => {
    signInWithGoogle();
  });

  // User menu toggle
  userMenuTrigger?.addEventListener('click', (e) => {
    e.stopPropagation();
    userMenuDropdown?.classList.toggle('is-open');
  });

  // User profile button in dropdown
  userMenuProfileBtn?.addEventListener('click', () => {
    openProfileModal();
  });

  // Close profile modal on close button click
  profileModalClose?.addEventListener('click', () => {
    closeProfileModal();
  });

  // Close profile modal on backdrop click
  profileModal?.addEventListener('click', (e) => {
    if (e.target === profileModal) {
      closeProfileModal();
    }
  });

  // Close user menu on outside click
  document.addEventListener('click', (e) => {
    if (userMenuDropdown && !userMenuContainer?.contains(e.target)) {
      userMenuDropdown.classList.remove('is-open');
    }
  });

  // Close dropdown and modal on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (userMenuDropdown?.classList.contains('is-open')) {
        userMenuDropdown.classList.remove('is-open');
      }
      if (profileModal?.classList.contains('is-open')) {
        closeProfileModal();
      }
    }
  });

  // Sign out button
  signOutBtn?.addEventListener('click', () => {
    userMenuDropdown?.classList.remove('is-open');
    signOut();
  });

  // Navbar scroll shadow
  window.addEventListener('scroll', () => {
    const navbar = $('nav.navbar');
    if (navbar) {
      navbar.classList.toggle('scrolled', window.scrollY > 10);
    }
  });
}


// ── Bootstrap ──

function init() {
  // Step 1: If Firebase is not configured, show the setup screen
  if (isFirebaseConfigMissing()) {
    showScreen('config');
    console.info(
      '%c[App] Firebase not configured. Showing setup instructions.',
      'color: #D4A843; font-weight: bold;'
    );
    return;
  }

  // Step 2: Show loading screen while auth observer initializes
  showScreen('loading');

  // Step 3: Populate storefront components immediately
  renderStorefront();

  // Step 4: Initialize auth observer — fires callback once initial auth state resolves
  initAuthObserver((user, profile) => {
    // Show the storefront view to both visitors and signed-in customers
    showScreen('storefront');
    updateNavbar(user, profile);

    // Initialize animations after DOM elements are in place
    setTimeout(() => {
      initAnimations();
    }, 60);
  });

  // Step 5: Listen for ongoing auth changes (sign-in / sign-out after initial load)
  onAuthChange((user, profile) => {
    updateNavbar(user, profile);
    if (profileModal?.classList.contains('is-open')) {
      renderProfileModal(user, profile);
    }
  });

  // Step 6: Wire up event handlers
  setupEventListeners();
}


// Start the app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
