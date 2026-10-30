/**
 * config.js — Storefront & Business Configuration
 * 
 * Central place for store settings, delivery fee rules, and communication channels.
 * 
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW TO CONFIGURE WHATSAPP FOR YOUR BUSINESS:
 * 1. Find the `whatsappPhone` property in `STORE_CONFIG` below.
 * 2. Enter your business WhatsApp phone number with international country code
 *    (e.g., "919840012345" for an Indian mobile number starting with +91).
 *    Do NOT include '+', hyphens, or spaces.
 * 3. When this string is empty (""), all WhatsApp direct enquiry/order buttons
 *    across the storefront, product details, and cart will be gracefully disabled
 *    with a tooltip informing the customer that WhatsApp ordering is unconfigured.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const STORE_CONFIG = {
  storeName: 'Sri Kamatchi Amman Traders',
  storeNameTamil: 'ஸ்ரீ காமாட்சி அம்மன் டிரேடர்ஸ்',
  tagline: 'Pure Cold Pressed Traditional Cooking Oils',
  location: 'Tamil Nadu, India',

  // Enter business WhatsApp number here with country code (e.g., '91XXXXXXXXXX')
  // Kept empty ("") by default until owner sets their official number.
  whatsappPhone: '919361455863',

  // Commerce rules
  deliveryFee: 40,              // Standard delivery fee in ₹
  freeDeliveryThreshold: 699,   // Free delivery on orders over ₹999
  codAvailable: true,           // Cash on delivery available

  // Fallback placeholder image
  placeholderImage: 'assets/images/placeholders/product-placeholder.webp'
};

/**
 * Returns whether WhatsApp communication is active and configured with a valid number.
 * @returns {boolean}
 */
export function isWhatsAppConfigured() {
  const phone = (STORE_CONFIG.whatsappPhone || '').replace(/\D/g, '');
  // Valid international format should be at least 10 digits
  return phone.length >= 10;
}

/**
 * Generates an official WhatsApp click-to-chat URL with encoded message.
 * Returns null if WhatsApp is not configured.
 * 
 * @param {string} message - Plain text message
 * @returns {string|null}
 */
export function buildWhatsAppLink(message) {
  if (!isWhatsAppConfigured()) return null;
  const cleanPhone = (STORE_CONFIG.whatsappPhone || '').replace(/\D/g, '');
  const encodedText = encodeURIComponent(message.trim());
  return `https://wa.me/${cleanPhone}?text=${encodedText}`;
}

