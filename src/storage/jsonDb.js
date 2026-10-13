/**
 * @file jsonDb.js
 * @description JSON disk storage adapter with memory cache and crash-resilient write sync.
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const env = require('../config/env');
const logger = require('../utils/logger');

const dbPath = path.isAbsolute(env.DB_FILE_PATH)
  ? env.DB_FILE_PATH
  : path.resolve(process.cwd(), env.DB_FILE_PATH);

// Ensure parent data directory exists
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const salt = bcrypt.genSaltSync(8);
const demoPasswordHash = bcrypt.hashSync(env.DEMO_MERCHANT_PASSWORD, salt);

const initialData = {
  merchants: [
    {
      id: 'm_demo',
      phone: '9999999999',
      password: demoPasswordHash,
      provider: 'paytm',
      upi_id: 'paytm.s1m66cw@pty',
      upi_ids: ['paytm.s1m66cw@pty'],
      fee_paid: true,
      razorpay_payment_id: 'pay_demo_init',
      status: 'active',
      merchant_code: '999999',
      user_codes: ['999999', 'MC-99'],
      is_demo: true,
      created_at: new Date().toISOString()
    }
  ],
  transactions: [],
  terminals: []
};

let memoryCache = null;

function readDb() {
  try {
    if (fs.existsSync(dbPath)) {
      const content = fs.readFileSync(dbPath, 'utf8').trim();
      const parsed = content ? JSON.parse(content) : {};

      if (!Array.isArray(parsed.terminals)) parsed.terminals = [];
      if (!Array.isArray(parsed.transactions)) parsed.transactions = [];
      if (!Array.isArray(parsed.merchants)) parsed.merchants = [];

      // Preserve memory state if transactions were modified in-memory
      if (memoryCache && Array.isArray(memoryCache.transactions)) {
        for (const memTxn of memoryCache.transactions) {
          const diskTxn = parsed.transactions.find(t => t.id === memTxn.id);
          if (!diskTxn) {
            parsed.transactions.push(memTxn);
          } else if (memTxn.status !== diskTxn.status || memTxn.current_part_index !== diskTxn.current_part_index) {
            Object.assign(diskTxn, memTxn);
          }
        }
      }

      // Preserve active terminal heartbeats
      if (memoryCache && Array.isArray(memoryCache.terminals)) {
        for (const memTerm of memoryCache.terminals) {
          const diskTerm = parsed.terminals.find(t => t.sessionId === memTerm.sessionId);
          if (!diskTerm) {
            parsed.terminals.push(memTerm);
          } else if ((memTerm.lastSeen || 0) > (diskTerm.lastSeen || 0)) {
            diskTerm.lastSeen = memTerm.lastSeen;
          }
        }
      }

      // Ensure demo merchant always exists with 6-digit code
      let modified = false;
      const demo = parsed.merchants.find(m => m.id === 'm_demo' || m.merchant_code === '999999' || m.merchant_code === 'MC-99');
      if (!demo) {
        parsed.merchants.unshift({
          id: 'm_demo',
          phone: '9999999999',
          password: demoPasswordHash,
          provider: 'paytm',
          upi_id: 'paytm.s1m66cw@pty',
          upi_ids: ['paytm.s1m66cw@pty'],
          fee_paid: true,
          razorpay_payment_id: 'pay_demo_init',
          status: 'active',
          merchant_code: '999999',
          user_codes: ['999999', 'MC-99'],
          is_demo: true,
          created_at: new Date().toISOString()
        });
        modified = true;
      } else if (demo.merchant_code !== '999999') {
        demo.merchant_code = '999999';
        if (!demo.user_codes) demo.user_codes = ['999999'];
        else if (!demo.user_codes.includes('999999')) demo.user_codes.unshift('999999');
        modified = true;
      }

      if (modified) {
        writeDb(parsed);
      }
      memoryCache = parsed;
      return parsed;
    }
  } catch (err) {
    logger.warn('Disk DB read error, using cache/fallback:', err.message);
  }

  if (memoryCache) {
    if (!Array.isArray(memoryCache.terminals)) memoryCache.terminals = [];
    if (!Array.isArray(memoryCache.transactions)) memoryCache.transactions = [];
    return memoryCache;
  }

  writeDb(initialData);
  return initialData;
}

function writeDb(data) {
  memoryCache = data;
  try {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    logger.error('Failed to write database to disk:', err.message);
  }
}

module.exports = {
  readDb,
  writeDb,
  dbPath,
  demoPasswordHash
};
