/**
 * @file db.js
 * @description Root facade re-exporting modular storage and UPI services.
 * Maintained for clean modular architecture and seamless backward compatibility.
 */

const { readDb, writeDb, dbPath } = require('./src/storage/jsonDb');
const MerchantStore = require('./src/storage/merchantStore');
const TransactionStore = require('./src/storage/transactionStore');
const TerminalStore = require('./src/storage/terminalStore');
const { splitAmount, buildUpiUri, buildChunks } = require('./src/services/upiService');
const { sanitizeMerchant, normalizePhone, generateMerchantCode } = require('./src/utils/helpers');

module.exports = {
  readDb,
  writeDb,
  dbPath,
  MerchantStore,
  TransactionStore,
  TerminalStore,
  splitAmount,
  buildUpiUri,
  buildChunks,
  sanitizeMerchant,
  normalizePhone,
  generateMerchantCode
};
