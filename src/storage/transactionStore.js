/**
 * @file transactionStore.js
 * @description Manages payment transactions, sequential chunk progression, approvals, and statistics.
 */

const { readDb, writeDb } = require('./jsonDb');
const { buildChunks } = require('../services/upiService');
const env = require('../config/env');
const constants = require('../config/constants');

const TransactionStore = {
  create({ merchant_id, user_code, total_amount, upi_id, upi_ids }) {
    const db = readDb();
    const merchant = db.merchants.find(m => m.id === merchant_id);
    if (!merchant) throw new Error('Merchant not found');

    let upiList = [];
    if (Array.isArray(upi_ids) && upi_ids.length > 0) {
      upiList = upi_ids.map(u => (typeof u === 'string' ? u.trim() : '')).filter(u => u && u.includes('@'));
    }
    if (upiList.length === 0 && upi_id && typeof upi_id === 'string' && upi_id.trim() && upi_id.includes('@')) {
      upiList = [upi_id.trim()];
    }
    if (upiList.length === 0) {
      if (Array.isArray(merchant.upi_ids) && merchant.upi_ids.length > 0) {
        upiList = merchant.upi_ids.filter(u => u && u.includes('@'));
      }
      if (upiList.length === 0 && merchant.upi_id) {
        upiList = [merchant.upi_id.trim()];
      }
    }
    if (upiList.length === 0) {
      upiList = [constants.DEFAULTS.PAYTM_UPI];
    }

    merchant.upi_ids = upiList;
    merchant.upi_id = upiList[0];

    const merchantCode = merchant.merchant_code || (merchant.user_codes && merchant.user_codes[0]) || '999999';
    const chunks = buildChunks(Number(total_amount), upiList);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + env.COUNTDOWN_TIMER_SECONDS * 1000);

    const newTxn = {
      id: 'txn_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      merchant_id,
      merchant_code: merchantCode,
      user_code: user_code || merchantCode,
      merchant_upi_id: merchant.upi_id,
      merchant_upi_ids: upiList,
      merchant_phone: merchant.phone,
      total_amount: Number(total_amount),
      split_count: chunks.length,
      current_part_index: 1, // 1-indexed
      chunks,
      splits: chunks, // backward compatibility
      status: constants.TRANSACTION_STATUS.PENDING,
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      approved_at: null,
      denied_at: null,
      approved_amount: 0
    };

    db.transactions.push(newTxn);
    writeDb(db);
    return newTxn;
  },

  findById(id) {
    const db = readDb();
    return db.transactions.find(t => t.id === id) || null;
  },

  getLatestForCode(code) {
    const db = readDb();
    const cleanCode = (code || '').trim().toUpperCase();
    const txns = db.transactions.filter(t => 
      (t.merchant_code && t.merchant_code.toUpperCase() === cleanCode) ||
      (t.user_code && t.user_code.toUpperCase() === cleanCode)
    );
    return txns.length ? txns[txns.length - 1] : null;
  },

  getLatestForMerchant(merchant_id) {
    const db = readDb();
    const txns = db.transactions.filter(t => t.merchant_id === merchant_id);
    return txns.length ? txns[txns.length - 1] : null;
  },

  getByMerchant(merchant_id) {
    const db = readDb();
    return db.transactions.filter(t => t.merchant_id === merchant_id).reverse();
  },

  getAll() {
    const db = readDb();
    return [...db.transactions].reverse();
  },

  approveCurrentChunk(id) {
    const db = readDb();
    const txn = db.transactions.find(t => t.id === id);
    if (!txn) throw new Error('Transaction not found');
    if (txn.status !== constants.TRANSACTION_STATUS.PENDING && txn.status !== constants.TRANSACTION_STATUS.SUBMITTED) {
      throw new Error(`Transaction is already ${txn.status}`);
    }

    const currentIdx = (txn.current_part_index || 1) - 1;
    const currentChunk = txn.chunks[currentIdx];
    if (!currentChunk) throw new Error('Invalid chunk index');

    currentChunk.status = constants.CHUNK_STATUS.APPROVED;
    currentChunk.approved_at = new Date().toISOString();
    txn.approved_amount = (txn.approved_amount || 0) + currentChunk.amount;

    const hasNextChunk = txn.current_part_index < txn.split_count;

    if (hasNextChunk) {
      txn.current_part_index += 1;
      const nextIdx = txn.current_part_index - 1;
      txn.chunks[nextIdx].status = constants.CHUNK_STATUS.PENDING;
      txn.expires_at = new Date(Date.now() + env.COUNTDOWN_TIMER_SECONDS * 1000).toISOString();
      txn.status = constants.TRANSACTION_STATUS.PENDING;

      writeDb(db);
      return {
        completed: false,
        approvedChunk: currentChunk,
        nextChunk: txn.chunks[nextIdx],
        txn
      };
    } else {
      txn.status = constants.TRANSACTION_STATUS.APPROVED;
      txn.approved_at = new Date().toISOString();

      writeDb(db);
      return {
        completed: true,
        approvedChunk: currentChunk,
        nextChunk: null,
        txn
      };
    }
  },

  denyTransaction(id) {
    const db = readDb();
    const txn = db.transactions.find(t => t.id === id);
    if (!txn) throw new Error('Transaction not found');

    const currentIdx = (txn.current_part_index || 1) - 1;
    if (txn.chunks && txn.chunks[currentIdx]) {
      txn.chunks[currentIdx].status = constants.CHUNK_STATUS.DENIED;
      txn.chunks[currentIdx].denied_at = new Date().toISOString();
    }
    txn.status = constants.TRANSACTION_STATUS.DENIED;
    txn.denied_at = new Date().toISOString();

    writeDb(db);
    return txn;
  },

  submitUtr(id, utr) {
    const db = readDb();
    const txn = db.transactions.find(t => t.id === id);
    if (!txn) throw new Error('Transaction not found');

    const cleanUtr = (utr || '').trim();
    txn.status = constants.TRANSACTION_STATUS.SUBMITTED;
    txn.utr = cleanUtr || 'Submitted (No UTR entered)';
    const currentIdx = (txn.current_part_index || 1) - 1;
    if (txn.chunks && txn.chunks[currentIdx]) {
      txn.chunks[currentIdx].status = constants.CHUNK_STATUS.SUBMITTED;
      txn.chunks[currentIdx].utr = cleanUtr || 'Submitted (No UTR entered)';
      txn.chunks[currentIdx].submitted_at = new Date().toISOString();
    }
    writeDb(db);
    return txn;
  },

  getActiveForMerchant(merchant_id) {
    const db = readDb();
    const now = Date.now();
    const txns = db.transactions.filter(t => 
      t.merchant_id === merchant_id && 
      (t.status === constants.TRANSACTION_STATUS.PENDING || t.status === constants.TRANSACTION_STATUS.SUBMITTED)
    );
    if (!txns.length) return null;

    const latest = txns[txns.length - 1];
    const exp = new Date(latest.expires_at).getTime();
    if (exp <= now) {
      latest.status = constants.TRANSACTION_STATUS.EXPIRED;
      writeDb(db);
      return null;
    }
    return latest;
  },

  getActiveForUserCode(user_code) {
    const db = readDb();
    const cleanCode = (user_code || '').trim().toUpperCase();
    const now = Date.now();
    const txns = db.transactions.filter(t => 
      ((t.merchant_code && t.merchant_code.toUpperCase() === cleanCode) ||
       (t.user_code && t.user_code.toUpperCase() === cleanCode)) &&
      (t.status === constants.TRANSACTION_STATUS.PENDING || t.status === constants.TRANSACTION_STATUS.SUBMITTED)
    );
    if (!txns.length) return null;

    const latest = txns[txns.length - 1];
    const exp = new Date(latest.expires_at).getTime();
    if (exp <= now) {
      latest.status = constants.TRANSACTION_STATUS.EXPIRED;
      writeDb(db);
      return null;
    }
    return latest;
  },

  getMerchantStats(merchant_id) {
    const db = readDb();
    const txns = db.transactions.filter(t => t.merchant_id === merchant_id);

    let totalRevenue = 0;
    let todayRevenue = 0;
    let approvedCount = 0;
    let deniedCount = 0;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    for (const t of txns) {
      if (t.status === constants.TRANSACTION_STATUS.APPROVED) {
        approvedCount++;
        totalRevenue += Number(t.total_amount || 0);

        const approvedDate = t.approved_at ? new Date(t.approved_at) : new Date(t.created_at);
        if (approvedDate >= startOfToday) {
          todayRevenue += Number(t.total_amount || 0);
        }
      } else if (t.status === constants.TRANSACTION_STATUS.DENIED) {
        deniedCount++;
      }
    }

    return {
      totalRevenue,
      todayRevenue,
      approvedCount,
      deniedCount,
      totalCount: txns.length
    };
  },

  getPlatformStats() {
    const db = readDb();
    let totalGMV = 0;
    let approvedCount = 0;

    for (const t of db.transactions) {
      if (t.status === constants.TRANSACTION_STATUS.APPROVED) {
        totalGMV += Number(t.total_amount || 0);
        approvedCount++;
      }
    }

    return {
      totalGMV,
      totalMerchants: db.merchants.length,
      activeMerchants: db.merchants.filter(m => m.status === constants.MERCHANT_STATUS.ACTIVE).length,
      totalTransactions: db.transactions.length,
      approvedTransactions: approvedCount,
      activeTerminalsCount: (db.terminals || []).length
    };
  }
};

module.exports = TransactionStore;
