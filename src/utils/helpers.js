/**
 * @file helpers.js
 * @description Common utility functions for normalization, unique codes, and validation.
 */

/**
 * Normalizes phone numbers to standard 10-digit Indian mobile format.
 * @param {string|number} phone
 * @returns {string} 10-digit phone or empty string
 */
function normalizePhone(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/**
 * Generates an assigned unique 6-digit numeric merchant code (e.g. 100000 - 999999).
 * Ensures no collision with existing merchant codes.
 * @param {Array<Object>} existingMerchants
 * @returns {string} 6-digit unique numeric code
 */
function generateMerchantCode(existingMerchants = []) {
  const existingCodes = new Set();
  for (const m of existingMerchants) {
    if (m.merchant_code) existingCodes.add(String(m.merchant_code).trim().toUpperCase());
    if (Array.isArray(m.user_codes)) {
      m.user_codes.forEach(c => existingCodes.add(String(c).trim().toUpperCase()));
    }
  }

  let code;
  let attempts = 0;
  do {
    // Generates 6-digit number between 100000 and 999999
    code = String(Math.floor(100000 + Math.random() * 900000));
    attempts++;
  } while (existingCodes.has(code) && attempts < 10000);

  return code;
}

/**
 * Sanitizes merchant object for safe client transmission (removes password hash).
 * @param {Object} merchant
 * @returns {Object|null}
 */
function sanitizeMerchant(merchant) {
  if (!merchant) return null;
  const { password, ...safe } = merchant;
  if (!safe.merchant_code && safe.user_codes && safe.user_codes[0]) {
    safe.merchant_code = safe.user_codes[0];
  }
  if (!Array.isArray(safe.upi_ids) || safe.upi_ids.length === 0) {
    safe.upi_ids = [safe.upi_id || 'paytm.s1m66cw@pty'];
  }
  return safe;
}

/**
 * Masks phone number for display (e.g. 98****3210).
 * @param {string} phone
 * @returns {string}
 */
function maskPhone(phone) {
  const clean = normalizePhone(phone);
  if (clean.length === 10) {
    return clean.replace(/(\d{2})\d{4}(\d{4})/, '$1****$2');
  }
  return clean;
}

module.exports = {
  normalizePhone,
  generateMerchantCode,
  sanitizeMerchant,
  maskPhone
};
