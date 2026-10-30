# 🛢️ TamilNadu Cooking Oils — E-Commerce Platform

Premium cold-pressed cooking oils from Tamil Nadu. Built with HTML5, CSS3, Vanilla JavaScript, and Firebase.

---

## Quick Start

### Prerequisites

- A Google account
- A modern web browser (Chrome, Firefox, Edge, Safari)
- A local HTTP server (required for ES modules — `file://` will not work)
- [Firebase CLI](https://firebase.google.com/docs/cli) (optional, for deployment)

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd Web1
```

### 2. Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **"Add project"** and follow the wizard
3. Once created, click the **gear icon → Project Settings**
4. Scroll to **"Your apps"** and click the **Web icon (`</>`)** to add a web app
5. Give it a name (e.g., "TN Oils Web") and click **Register app**
6. Copy the `firebaseConfig` object shown on screen

### 3. Configure Firebase in the Project

Open `js/firebase-config.js` and replace the placeholder values:

```javascript
const firebaseConfig = {
  apiKey:            "AIzaSy...",           // ← Your API key
  authDomain:        "your-project.firebaseapp.com",
  projectId:         "your-project",
  storageBucket:     "your-project.firebasestorage.app",
  messagingSenderId: "123456789",
  appId:             "1:123456789:web:abc123"
};
```

> **Note:** These are client-side identifiers, not secret keys. Security is enforced by Firestore Security Rules.

### 4. Enable Google Sign-In

1. In the Firebase Console, go to **Authentication → Sign-in method**
2. Click **Google**
3. Toggle **Enable**
4. Set a **Project support email** (your email)
5. Click **Save**

### 5. Create a Firestore Database

1. In the Firebase Console, go to **Firestore Database**
2. Click **"Create database"**
3. Choose **"Start in production mode"** (our rules handle access control)
4. Select a Cloud Firestore location closest to Tamil Nadu (e.g., `asia-south1` — Mumbai)
5. Click **Enable**

### 6. Deploy Security Rules (Optional)

If you have the Firebase CLI installed:

```bash
firebase login
firebase init  # Select Firestore and Hosting, use existing project
firebase deploy --only firestore:rules,storage
```

Or manually copy the rules from `firestore.rules` and `storage.rules` into the Firebase Console:
- **Firestore → Rules** tab
- **Storage → Rules** tab

### 7. Run Locally

You need an HTTP server because ES modules don't work with `file://` URLs.

**Option A — Python (pre-installed on most systems):**
```bash
python -m http.server 8080
# Then open http://localhost:8080
```

**Option B — Node.js (npx, no install needed):**
```bash
npx -y serve .
# Then open the URL shown in terminal
```

**Option C — VS Code Live Server:**
1. Install the "Live Server" extension
2. Right-click `index.html` → **"Open with Live Server"**

---

## Project Structure

```
Web1/
├── index.html              ← Entry point (navbar + auth + dashboard shell)
├── firebase.json           ← Firebase Hosting configuration
├── firestore.rules         ← Firestore Security Rules
├── storage.rules           ← Storage Security Rules
├── .env.example            ← Placeholder config (copy to .env)
├── .gitignore
│
├── css/
│   ├── global.css          ← Design tokens, reset, typography, layout
│   └── components.css      ← Navbar, buttons, auth screens, toasts
│
├── js/
│   ├── app.js              ← Main entry — lifecycle, UI state management
│   ├── firebase-config.js  ← Firebase SDK init + config validation
│   ├── auth.js             ← Google Sign-In/Out, auth observer, profile sync
│   ├── firestore.js        ← Firestore CRUD (users implemented, rest stubbed)
│   ├── utils.js            ← Helpers (formatPrice, sanitize, toast, DOM)
│   ├── storage.js          ← Firebase Storage (stub)
│   ├── cart.js             ← Shopping cart (stub)
│   ├── payment.js          ← Razorpay integration (stub)
│   ├── animations.js       ← GSAP animations (stub)
│   ├── admin.js            ← Admin dashboard (stub)
│   └── router.js           ← Navigation helpers (stub)
│
└── assets/
    └── images/             ← Static images (empty, Phase 2)
```

---

## Security Model

| Rule | Enforcement |
|---|---|
| New users always get `role: "customer"` | `firestore.js` + Firestore rules (`request.resource.data.role == 'customer'` on create) |
| Users cannot change their own role | Firestore rules block role field changes on update |
| Users cannot read other users' data | Firestore rules: `isOwner(userId) \|\| isAdmin()` |
| Products are publicly readable | Firestore rules: `allow read: if true` |
| Only admins can write products/orders | Firestore rules: `isAdmin()` check |
| File uploads are size & type restricted | Storage rules: 5MB images for products, 2MB for avatars |
| No public write to any collection | Default deny rule: `allow read, write: if false` |

### How to Make a User an Admin

Admin role assignment is **never done through frontend code**. To grant admin access:

1. Go to **Firebase Console → Firestore**
2. Open the `users` collection
3. Find the user's document (keyed by their UID)
4. Edit the `role` field from `"customer"` to `"admin"`
5. Save

---

## Testing Checklist

After configuring Firebase, verify:

- [ ] **Config screen**: Remove Firebase config → page shows "Firebase Setup Required" screen
- [ ] **Sign-in**: Click "Sign in with Google" → Google popup appears → signs in successfully
- [ ] **Profile creation**: After first sign-in, check Firestore `users` collection → new document exists with `role: "customer"`
- [ ] **Dashboard**: After sign-in, user sees welcome dashboard with name, email, UID, and "Coming Soon" cards
- [ ] **User menu**: Click avatar → dropdown shows name, email, sign-out option
- [ ] **Sign-out**: Click "Sign Out" → returns to welcome screen
- [ ] **Return visit**: Sign in again → "Welcome back" toast (no duplicate profile created)
- [ ] **Security**: Try changing `role` to `"admin"` in browser DevTools → Firestore rules should reject the write
- [ ] **Responsive**: Resize browser → layout adapts to mobile

---

## Implementation Phases

- [x] **Phase 1: Foundation** — Project structure, Firebase, Google auth, security rules
- [x] **Phase 2: Storefront UI** — Premium responsive homepage, GSAP animations, categories, sample demo products
- [x] **Phase 3: Admin Dashboard** — Dedicated admin portal, product & multi-size variant CRUD, Firebase Storage image uploads, low-stock alerts, real orders inspection, server-side admin authorization
- [ ] **Phase 4: Commerce & Payments** — Shopping cart, checkout flow, Razorpay payment gateway
- [ ] **Phase 5: Polish & Deployment** — Final micro-interactions, SEO optimization, Firebase Hosting deployment

---

## Admin Authorization & Setup

All new Google accounts default to the `customer` role. Admin access is strictly enforced by Firestore Security Rules.

### How to Authorize an Administrator:

Choose either method below in the Firebase Console:

**Method A: Promote existing user document**
1. In [Firebase Console](https://console.firebase.google.com/) &rarr; **Firestore Database** &rarr; `users` collection.
2. Locate the user document matching the Google account UID.
3. Edit the `role` field value from `"customer"` to `"admin"`.

**Method B: Server-Managed `/admins` Collection (Allowlist)**
1. In Firestore Database, create a collection named `admins`.
2. Add a document where the **Document ID** is the user's UID (e.g. `admins/<uid>`).
3. Set fields `{ "email": "admin@example.com", "authorizedAt": true }`.
4. *Note: The `/admins` collection has `allow write: if false;` in security rules, meaning users can never grant themselves admin rights from browser code.*

Once authorized, open `/admin.html` or click **⚙️ Admin Portal** in the storefront user menu.

---

## Local Product Image Asset Management

To avoid requiring a paid Firebase Blaze plan for Firebase Storage, product images are served as static files directly through Firebase Hosting:

### 1. Where Image Files Live
- **Product Images**: `assets/images/products/`
- **Fallback Placeholder**: `assets/images/placeholders/product-placeholder.webp`
- **Logos & Brand**: `assets/images/logo/`
- **Category Icons**: `assets/images/categories/`

### 2. How to Add a New Product Image
1. Place your image file (e.g. `groundnut-cold-pressed.webp`) into `assets/images/products/`.
2. In the Admin Dashboard (`admin.html`), edit or create the product.
3. In the **Product Image Asset Path** field, enter:
   `assets/images/products/groundnut-cold-pressed.webp`
   *(Or click "📁 Pick File" to automatically set the path and preview the image).*
4. Click **Save Product**.

### 3. Deploying to Live Hosting
Whenever you add new images to the `assets/` directory, deploy them with:
```bash
firebase deploy --only hosting
```
All static images are automatically served with global CDN caching.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, Vanilla JS (ES Modules) |
| Backend | Firebase (Auth, Firestore, Storage, Hosting) |
| Auth | Firebase Auth + Google Sign-In |
| Payments | Razorpay (Phase 3) |
| Animations | GSAP (Phase 5) |
| Typography | Google Fonts — Outfit, Inter, Noto Sans Tamil |

---

## License

This project is a learning/portfolio demo. All rights reserved.
