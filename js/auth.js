/**
 * auth.js — Authentication Module
 * 
 * Handles Google Sign-In, Sign-Out, auth state observation,
 * and first-time user profile creation in Firestore.
 * 
 * SECURITY:
 * - New users always get role: "customer". 
 * - Role changes are blocked by Firestore Security Rules.
 * - The frontend never reads or trusts client-set roles for authorization;
 *   that is enforced server-side via Firestore rules.
 */

import { auth, googleProvider, isFirebaseConfigMissing } from './firebase-config.js';
import { createUserProfile, getUserProfile, checkIsAdminInFirestore } from './firestore.js';
import { showToast } from './utils.js';

import {
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js';


// ── State ──
let currentUser = null;
let currentUserProfile = null;
let authStateListeners = [];
let isExplicitSignIn = false; // True when signInWithGoogle() triggers the auth change
let isAuthResolved = false;   // True once Firebase Auth completes initial state resolution
let isObserverInitialized = false; // Prevents redundant onAuthStateChanged registrations
let pendingOnReadyCallbacks = [];  // Collects onReady callbacks across repeated init calls


/**
 * Returns the currently signed-in Firebase user, or null.
 */
export function getCurrentUser() {
  return currentUser;
}

/**
 * Returns the Firestore profile document for the current user, or null.
 */
export function getCurrentUserProfile() {
  return currentUserProfile;
}

/**
 * Checks whether the currently signed-in user has admin privileges.
 * Validates against both user profile role and server-managed /admins allowlist.
 * @returns {Promise<boolean>}
 */
export async function isCurrentUserAdmin() {
  if (!currentUser) return false;
  if (currentUserProfile?.role === 'admin') return true;
  return await checkIsAdminInFirestore(currentUser.uid);
}


/**
 * Register a callback that fires whenever auth state changes.
 * The callback receives (user, profile) — both may be null if signed out.
 * 
 * @param {Function} listener - (user: FirebaseUser|null, profile: Object|null) => void
 * @returns {Function} Unsubscribe function
 */
export function onAuthChange(listener) {
  authStateListeners.push(listener);

  // Immediately fire with current state ONLY if auth has completed initial resolution
  if (isAuthResolved) {
    listener(currentUser, currentUserProfile);
  }

  return () => {
    authStateListeners = authStateListeners.filter(l => l !== listener);
  };
}

/**
 * Notify all registered listeners of an auth state change.
 */
function notifyListeners(user, profile) {
  for (const listener of authStateListeners) {
    try {
      listener(user, profile);
    } catch (err) {
      console.error('[Auth] Listener error:', err);
    }
  }
}


/**
 * Sign in with Google popup.
 * If this is the user's first sign-in, a Firestore profile is created
 * with role: "customer".
 */
export async function signInWithGoogle() {
  if (isFirebaseConfigMissing()) {
    showToast('Firebase is not configured. See README.md for setup instructions.', 'error');
    return null;
  }

  try {
    // Set flag BEFORE the popup so onAuthStateChanged knows this was user-initiated
    isExplicitSignIn = true;
    await signInWithPopup(auth, googleProvider);
    // Profile sync and welcome toast are handled by onAuthStateChanged.
    // Do NOT call Firestore here — the Firestore SDK may not have the
    // auth token yet, causing "Missing or insufficient permissions".
    return currentUser;
  } catch (error) {
    isExplicitSignIn = false;

    if (error.code === 'auth/popup-closed-by-user') {
      return null;
    }
    if (error.code === 'auth/popup-blocked') {
      showToast('Sign-in popup was blocked. Please allow popups for this site.', 'error');
      return null;
    }

    console.error('[Auth] Sign-in error:', error);
    showToast('Sign-in failed. Please try again.', 'error');
    return null;
  }
}


/**
 * Sign out the current user.
 */
export async function signOut() {
  if (!auth) return;

  try {
    await firebaseSignOut(auth);
    showToast('You have been signed out.', 'info');
  } catch (error) {
    console.error('[Auth] Sign-out error:', error);
    showToast('Sign-out failed. Please try again.', 'error');
  }
}


/**
 * Initialize the Firebase Auth state observer.
 * This is called once on app startup and continuously monitors auth state.
 * 
 * @param {Function} onReady - Called once when the initial auth state is resolved.
 */
export function initAuthObserver(onReady) {
  if (isFirebaseConfigMissing()) {
    currentUser = null;
    currentUserProfile = null;
    isAuthResolved = true;
    if (onReady) onReady(null, null);
    return;
  }

  // Handle onReady callback registration
  if (onReady) {
    if (isAuthResolved) {
      onReady(currentUser, currentUserProfile);
    } else {
      pendingOnReadyCallbacks.push(onReady);
    }
  }

  // Prevent duplicate onAuthStateChanged registrations if called repeatedly
  if (isObserverInitialized) {
    return;
  }
  isObserverInitialized = true;

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;

      // Fetch the user's Firestore profile
      try {
        currentUserProfile = await getUserProfile(user.uid);

        if (!currentUserProfile) {
          // First-time user — create profile with customer role
          currentUserProfile = await createUserProfile(user);
          if (isExplicitSignIn) {
            showToast(`Welcome, ${user.displayName || 'there'}! Your account has been created.`, 'success');
          }
        } else if (isExplicitSignIn) {
          showToast(`Welcome back, ${currentUserProfile.displayName || user.displayName || 'there'}!`, 'success');
        }
      } catch (error) {
        console.error('[Auth] Failed to fetch user profile:', error);
        currentUserProfile = null;
      }

      isExplicitSignIn = false;
    } else {
      currentUser = null;
      currentUserProfile = null;
    }

    isAuthResolved = true;
    notifyListeners(currentUser, currentUserProfile);

    // Drain one-shot onReady callbacks
    const callbacks = pendingOnReadyCallbacks;
    pendingOnReadyCallbacks = [];
    for (const cb of callbacks) {
      try {
        cb(currentUser, currentUserProfile);
      } catch (err) {
        console.error('[Auth] onReady callback error:', err);
      }
    }
  });
}
