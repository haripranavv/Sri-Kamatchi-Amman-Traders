/**
 * storage.js — Firebase Storage Module (Optional / Legacy)
 * 
 * NOTE: The application now stores product images locally in assets/images/products/
 * deployed directly via Firebase Hosting. This removes the requirement for a paid
 * Firebase Blaze plan.
 * 
 * The utilities in this file are preserved for backward compatibility if cloud storage
 * is configured in the future, but are not invoked during normal storefront or admin flows.
 */

import { storage } from './firebase-config.js';
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-storage.js';

// Allowed image MIME types
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
// Maximum file size: 5 MB
const MAX_FILE_SIZE = 5 * 1024 * 1024;


/**
 * Validate an image file before upload.
 * @param {File} file
 * @throws {Error} if validation fails
 */
export function validateImageFile(file) {
  if (!file) {
    throw new Error('No file provided for upload.');
  }

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    throw new Error(`Unsupported image format (${file.type || 'unknown'}). Please upload a JPEG, PNG, WebP, or GIF image.`);
  }

  if (file.size > MAX_FILE_SIZE) {
    const sizeInMB = (file.size / (1024 * 1024)).toFixed(1);
    throw new Error(`File size (${sizeInMB} MB) exceeds the 5 MB limit. Please compress the image.`);
  }

  return true;
}


/**
 * Upload a product image to Firebase Storage.
 * Stored at: /products/{productId}/{timestamp}_{filename}
 * 
 * @param {File} file - The file to upload.
 * @param {string} productId - The product ID (or 'new' for drafts).
 * @returns {Promise<{ downloadURL: string, path: string }>}
 */
export async function uploadProductImage(file, productId = 'general') {
  if (!storage) {
    throw new Error('Firebase Storage is not initialized.');
  }

  validateImageFile(file);

  const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const timestamp = Date.now();
  const filePath = `products/${productId}/${timestamp}_${cleanName}`;
  const storageRef = ref(storage, filePath);

  try {
    const metadata = {
      contentType: file.type,
      customMetadata: {
        uploadedAt: new Date().toISOString()
      }
    };

    const snapshot = await uploadBytes(storageRef, file, metadata);
    const downloadURL = await getDownloadURL(snapshot.ref);

    return { downloadURL, path: filePath };
  } catch (error) {
    console.error('[Storage] Upload error:', error);
    if (error.code === 'storage/unauthorized') {
      throw new Error('Permission denied: You must be an authorized administrator to upload product images.');
    }
    throw error;
  }
}


/**
 * Delete a product image from Firebase Storage.
 * @param {string} imagePathOrUrl - The storage path (e.g. products/xxx/img.jpg) or download URL.
 * @returns {Promise<boolean>}
 */
export async function deleteProductImage(imagePathOrUrl) {
  if (!storage || !imagePathOrUrl) return false;

  try {
    let fileRef;
    if (imagePathOrUrl.startsWith('http')) {
      fileRef = ref(storage, imagePathOrUrl);
    } else {
      fileRef = ref(storage, imagePathOrUrl);
    }

    await deleteObject(fileRef);
    console.log('[Storage] Deleted product image:', imagePathOrUrl);
    return true;
  } catch (error) {
    console.warn('[Storage] Delete image warning:', error.message);
    // Even if storage delete fails (e.g. file was already deleted), return false without crashing
    return false;
  }
}


export { storage };
