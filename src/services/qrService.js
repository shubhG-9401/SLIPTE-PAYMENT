/**
 * @file qrService.js
 * @description Generates high-contrast styled QR codes for dynamic UPI payloads.
 */

const QRCode = require('qrcode');

const qrService = {
  /**
   * Generates a base64 Data URL for a given payload text.
   * @param {string} text Target UPI URI or URL
   * @param {Object} options Custom options
   * @returns {Promise<string>} Data URL
   */
  async generateDataUrl(text, options = {}) {
    if (!text) {
      throw new Error('QR generation requires a valid non-empty string payload');
    }

    return QRCode.toDataURL(text, {
      width: options.width || 320,
      margin: options.margin || 2,
      color: {
        dark: options.dark || '#002970',
        light: options.light || '#ffffff'
      }
    });
  }
};

module.exports = qrService;
