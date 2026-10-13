/**
 * @file utils.js
 * @description Frontend formatting, clipboard, and calculation utilities.
 */

(function (window) {
  'use strict';

  const utils = {
    /**
     * Formats numerical values to Indian Rupee representation (e.g. ₹1,999.00).
     * @param {number} amount
     * @returns {string}
     */
    formatCurrency(amount) {
      const num = Number(amount) || 0;
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(num);
    },

    /**
     * Client-side calculation of sequential splits <= 1999.
     * @param {number} totalAmount
     * @param {number} max
     * @returns {Array<number>}
     */
    calculateSplits(totalAmount, max = 1999) {
      const amount = parseFloat(totalAmount);
      if (isNaN(amount) || amount <= 0) return [];
      if (amount <= max) return [amount];

      const parts = [];
      let remaining = amount;
      while (remaining > max) {
        parts.push(max);
        remaining = Math.round((remaining - max) * 100) / 100;
      }
      if (remaining > 0) parts.push(remaining);
      return parts;
    },

    /**
     * Generates dynamic UPI URI string for previewing or opening.
     * @param {string} upiId
     * @param {number} amount
     * @param {string} note
     * @returns {string}
     */
    buildUpiUri(upiId, amount, note = 'Verified Merchant Account') {
      const cleanUpi = (upiId || 'paytm.s1m66cw@pty').trim();
      const amtStr = Number(amount).toFixed(2).replace(/\.00$/, '');
      return `upi://pay?pa=${cleanUpi}&am=${amtStr}&cu=INR&tn=${encodeURIComponent(note)}`;
    },

    /**
     * Copies string to clipboard with button feedback text.
     * @param {string} text
     * @param {HTMLElement} [btnElement]
     */
    async copyToClipboard(text, btnElement = null) {
      try {
        await navigator.clipboard.writeText(text);
        if (btnElement) {
          const original = btnElement.textContent;
          btnElement.textContent = '✓ Copied!';
          setTimeout(() => { btnElement.textContent = original; }, 1600);
        }
        return true;
      } catch (err) {
        console.warn('Clipboard write failed:', err);
        return false;
      }
    },

    /**
     * Formats an ISO date into localized date and time.
     * @param {string} isoString
     * @returns {string}
     */
    formatDate(isoString) {
      if (!isoString) return '-';
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + d.toLocaleDateString();
    }
  };

  window.appUtils = utils;
})(window);
