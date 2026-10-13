/**
 * @file upiService.js
 * @description Encapsulates UPI payment rules, amount splitting (<= ₹1999), and multi-account payload routing.
 */

const env = require('../config/env');

/**
 * Splits an amount into chunks of at most SPLIT_MAX_AMOUNT (default 1999).
 * Condition A: Amount <= 1999 -> [amount]
 * Condition B: Amount > 1999 -> [1999, 1999, ..., remainder]
 * @param {number} totalAmount
 * @returns {Array<number>}
 */
function splitAmount(totalAmount) {
  const amount = Number(totalAmount);
  if (isNaN(amount) || amount <= 0) return [];

  const max = env.SPLIT_MAX_AMOUNT;
  if (amount <= max) return [amount];

  const parts = [];
  let remaining = amount;
  while (remaining > max) {
    parts.push(max);
    remaining = Math.round((remaining - max) * 100) / 100;
  }
  if (remaining > 0) {
    parts.push(remaining);
  }
  return parts;
}

/**
 * Builds a compliant standard UPI URI for QR codes and deep links.
 * Format: upi://pay?pa={upiId}&pn={payeeName}&am={amount}&cu=INR&tn={note}
 * @param {string} upiId
 * @param {number} amount
 * @param {string} payeeName
 * @param {string} note
 * @returns {string}
 */
function buildUpiUri(upiId, amount, payeeName = 'Verified Merchant Account', note = 'Verified Merchant Account') {
  const cleanUpi = (upiId || 'merchant@paytm').trim();
  const amtStr = Number(amount).toFixed(2).replace(/\.00$/, '');
  return `upi://pay?pa=${cleanUpi}&am=${amtStr}&cu=INR&tn=${encodeURIComponent(note)}`;
}

/**
 * Generates an array of sequential transaction chunks mapped across provided UPI accounts.
 * @param {number} totalAmount
 * @param {Array<string>} upiList
 * @returns {Array<Object>}
 */
function buildChunks(totalAmount, upiList = []) {
  const splitValues = splitAmount(totalAmount);
  const upis = upiList.length > 0 ? upiList : ['paytm.s1m66cw@pty'];

  return splitValues.map((amt, idx) => {
    const chunkUpi = upis[idx % upis.length];
    return {
      part_index: idx + 1,
      total_parts: splitValues.length,
      amount: amt,
      upi_id: chunkUpi,
      upi_uri: buildUpiUri(chunkUpi, amt),
      status: idx === 0 ? 'pending' : 'queued',
      approved_at: null,
      denied_at: null,
      submitted_at: null,
      utr: null
    };
  });
}

module.exports = {
  splitAmount,
  buildUpiUri,
  buildChunks
};
