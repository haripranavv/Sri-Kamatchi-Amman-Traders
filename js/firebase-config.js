/**
 * firebase-config.js — Firebase Initialization
 * 
 * Loads Firebase client SDK via CDN (ES module imports) and initializes
 * the app with project configuration.
 * 
 * SECURITY NOTE:
 * The values below are CLIENT-SIDE identifiers. They tell the Firebase SDK
 * which project to connect to but do NOT grant privileged access. All actual
 * security is enforced by Firestore Security Rules and Storage Security Rules.
 * 
 * HOW TO CONFIGURE:
 * Replace the placeholder values with your own Firebase project config.
 * Find them at: Firebase Console → Project Settings → General → Your apps → Web app config.
 */

// ── Firebase SDK (CDN ES Modules) ──
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js';
import { getAuth, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-storage.js';

// ── Firebase Configuration ──
// TODO: Replace these placeholder values with your Firebase project config.
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyB6Vtb5mDQ17sHc9tA7Vvu1tgPnQxWOhTU",
  authDomain: "sri-kamatchi-amman-traders.firebaseapp.com",
  projectId: "sri-kamatchi-amman-traders",
  storageBucket: "sri-kamatchi-amman-traders.firebasestorage.app",
  messagingSenderId: "584463553784",
  appId: "1:584463553784:web:b97b5c128d257e5afd570d",
  measurementId: "G-J0F5TZXQQK"
};
// ── Configuration Validation ──
const PLACEHOLDER_PATTERN = /^YOUR_/;

/**
 * Returns true if the Firebase config contains placeholder values
 * that have not been replaced with real project credentials.
 */
export function isFirebaseConfigMissing() {
  return PLACEHOLDER_PATTERN.test(firebaseConfig.apiKey)
    || PLACEHOLDER_PATTERN.test(firebaseConfig.projectId)
    || PLACEHOLDER_PATTERN.test(firebaseConfig.appId);
}

// ── Initialize Firebase ──
let app = null;
let auth = null;
let db = null;
let storage = null;
let googleProvider = null;

if (!isFirebaseConfigMissing()) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    storage = getStorage(app);
    googleProvider = new GoogleAuthProvider();

    // Request email scope for profile information
    googleProvider.addScope('email');
    googleProvider.addScope('profile');

    console.log('[Firebase] Initialized successfully for project:', firebaseConfig.projectId);
  } catch (error) {
    console.error('[Firebase] Initialization failed:', error.message);
  }
} else {
  console.warn(
    '[Firebase] Configuration contains placeholder values.\n' +
    'Replace the values in js/firebase-config.js with your Firebase project config.\n' +
    'See README.md for setup instructions.'
  );
}

export { app, auth, db, storage, googleProvider };
