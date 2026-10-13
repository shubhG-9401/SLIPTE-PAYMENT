/**
 * @file merchantStore.js
 * @description Merchant account persistence, authentication, credential validation and code generation.
 */

const bcrypt = require('bcryptjs');
const { readDb, writeDb, demoPasswordHash } = require('./jsonDb');
const { normalizePhone, generateMerchantCode, sanitizeMerchant } = require('../utils/helpers');
const env = require('../config/env');
const constants = require('../config/constants');

const MerchantStore = {
  create({ phone, password, provider = 'paytm', upi_id, upi_ids, fee_paid = true, razorpay_payment_id = null }) {
    const db = readDb();
    const cleanPhone = normalizePhone(phone);
    if (!cleanPhone || cleanPhone.length !== 10) {
      throw new Error('Please enter a valid 10-digit mobile number');
    }
    const existing = db.merchants.find(m => normalizePhone(m.phone) === cleanPhone);
    if (existing) {
      throw new Error(`Mobile number ${cleanPhone} is already registered. Please login or use a different number.`);
    }

    const salt = bcrypt.genSaltSync(8);
    const passwordHash = bcrypt.hashSync(password, salt);
    const code = generateMerchantCode(db.merchants);

    let upiList = [];
    if (Array.isArray(upi_ids) && upi_ids.length > 0) {
      upiList = upi_ids.map(u => (typeof u === 'string' ? u.trim() : '')).filter(u => u && u.includes('@'));
    }
    if (upiList.length === 0 && upi_id && typeof upi_id === 'string' && upi_id.trim() && upi_id.includes('@')) {
      upiList = [upi_id.trim()];
    }
    if (upiList.length === 0) {
      upiList = [constants.DEFAULTS.PAYTM_UPI];
    }

    const newMerchant = {
      id: 'm_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      phone: cleanPhone,
      password: passwordHash,
      provider: provider || 'paytm',
      upi_id: upiList[0],
      upi_ids: upiList,
      fee_paid: !!fee_paid,
      razorpay_payment_id: razorpay_payment_id || null,
      status: constants.MERCHANT_STATUS.ACTIVE,
      merchant_code: code,
      user_codes: [code],
      created_at: new Date().toISOString()
    };

    db.merchants.push(newMerchant);
    writeDb(db);
    return sanitizeMerchant(newMerchant);
  },

  getDemoMerchant() {
    const db = readDb();
    let demo = db.merchants.find(m => m.merchant_code === '999999' || m.id === 'm_demo' || m.merchant_code === 'MC-99');
    if (!demo) {
      demo = {
        id: 'm_demo',
        phone: constants.DEFAULTS.DEMO_PHONE,
        password: demoPasswordHash,
        provider: 'paytm',
        upi_id: constants.DEFAULTS.PAYTM_UPI,
        upi_ids: [constants.DEFAULTS.PAYTM_UPI],
        fee_paid: true,
        razorpay_payment_id: 'pay_demo_init',
        status: constants.MERCHANT_STATUS.ACTIVE,
        merchant_code: constants.DEFAULTS.DEMO_MERCHANT_CODE,
        user_codes: [constants.DEFAULTS.DEMO_MERCHANT_CODE, 'MC-99'],
        is_demo: true,
        created_at: new Date().toISOString()
      };
      db.merchants.unshift(demo);
      writeDb(db);
    } else if (demo.merchant_code !== '999999') {
      demo.merchant_code = '999999';
      if (!demo.user_codes) demo.user_codes = ['999999'];
      else if (!demo.user_codes.includes('999999')) demo.user_codes.unshift('999999');
      if (!Array.isArray(demo.upi_ids) || demo.upi_ids.length === 0) {
        demo.upi_ids = [demo.upi_id || constants.DEFAULTS.PAYTM_UPI];
      }
      writeDb(db);
    }
    return sanitizeMerchant(demo);
  },

  verifyOrRegisterRazorpay({ phone, password, provider, upi_id, razorpay_payment_id }) {
    const db = readDb();
    let merchant = db.merchants.find(m => m.phone === phone);
    if (merchant) {
      merchant.fee_paid = true;
      merchant.razorpay_payment_id = razorpay_payment_id;
      merchant.status = constants.MERCHANT_STATUS.ACTIVE;
      if (password) {
        const salt = bcrypt.genSaltSync(8);
        merchant.password = bcrypt.hashSync(password, salt);
      }
      if (upi_id) {
        merchant.upi_id = upi_id;
        merchant.upi_ids = [upi_id];
      }
      writeDb(db);
      return sanitizeMerchant(merchant);
    }

    return this.create({
      phone,
      password,
      provider: provider || 'paytm',
      upi_id,
      fee_paid: true,
      razorpay_payment_id
    });
  },

  verifyUpiPayment({ phone, password, provider, upi_id, utr }) {
    const db = readDb();
    let merchant = db.merchants.find(m => m.phone === phone);
    if (merchant) {
      merchant.fee_paid = true;
      merchant.utr = utr;
      merchant.status = constants.MERCHANT_STATUS.ACTIVE;
      if (password) {
        const salt = bcrypt.genSaltSync(8);
        merchant.password = bcrypt.hashSync(password, salt);
      }
      if (upi_id) {
        merchant.upi_id = upi_id;
        merchant.upi_ids = [upi_id];
      }
      writeDb(db);
      return sanitizeMerchant(merchant);
    }

    return this.create({
      phone,
      password,
      provider: provider || 'paytm',
      upi_id,
      fee_paid: true
    });
  },

  findByPhone(phone) {
    const db = readDb();
    const cleanPhone = normalizePhone(phone);
    if (!cleanPhone) return null;
    return db.merchants.find(m => normalizePhone(m.phone) === cleanPhone) || null;
  },

  findById(id) {
    const db = readDb();
    return db.merchants.find(m => m.id === id) || null;
  },

  findByMerchantCode(code) {
    const db = readDb();
    const cleanCode = (code || '').trim().toUpperCase();
    return db.merchants.find(m => 
      (m.merchant_code && m.merchant_code.toUpperCase() === cleanCode) ||
      (Array.isArray(m.user_codes) && m.user_codes.some(c => c.toUpperCase() === cleanCode))
    ) || null;
  },

  findByUserCode(code) {
    return this.findByMerchantCode(code);
  },

  getAll() {
    const db = readDb();
    return db.merchants.map(sanitizeMerchant);
  },

  updateStatus(id, status) {
    const db = readDb();
    const merchant = db.merchants.find(m => m.id === id);
    if (!merchant) throw new Error('Merchant not found');
    merchant.status = status;
    writeDb(db);
    return sanitizeMerchant(merchant);
  },

  resetPassword(id, newPassword) {
    const db = readDb();
    const merchant = db.merchants.find(m => m.id === id);
    if (!merchant) throw new Error('Merchant not found');
    const salt = bcrypt.genSaltSync(8);
    merchant.password = bcrypt.hashSync(newPassword, salt);
    writeDb(db);
    return true;
  },

  regenerateUserCodes(id) {
    const db = readDb();
    const merchant = db.merchants.find(m => m.id === id);
    if (!merchant) throw new Error('Merchant not found');
    const newCode = generateMerchantCode(db.merchants);
    merchant.merchant_code = newCode;
    merchant.user_codes = [newCode];
    writeDb(db);
    return merchant.user_codes;
  },

  updateUpi(id, upiId, upiIds) {
    const db = readDb();
    const merchant = db.merchants.find(m => m.id === id);
    if (!merchant) return null;

    let upiList = [];
    if (Array.isArray(upiIds) && upiIds.length > 0) {
      upiList = upiIds.map(u => (typeof u === 'string' ? u.trim() : '')).filter(u => u && u.includes('@'));
    }
    if (upiList.length === 0 && upiId && typeof upiId === 'string' && upiId.trim() && upiId.includes('@')) {
      upiList = [upiId.trim()];
    }
    if (upiList.length > 0) {
      merchant.upi_ids = upiList;
      merchant.upi_id = upiList[0];
    } else if (upiId) {
      merchant.upi_id = upiId.trim();
      merchant.upi_ids = [merchant.upi_id];
    }
    writeDb(db);
    return sanitizeMerchant(merchant);
  },

  delete(id) {
    const db = readDb();
    const idx = db.merchants.findIndex(m => m.id === id || m.merchant_code === id);
    if (idx === -1) return false;
    const merchantId = db.merchants[idx].id;
    db.merchants.splice(idx, 1);
    db.transactions = db.transactions.filter(t => t.merchant_id !== merchantId);
    writeDb(db);
    return true;
  },

  clearFakeData({ keepDemo = true } = {}) {
    const db = readDb();
    if (keepDemo) {
      db.merchants = db.merchants.filter(m => m.is_demo === true || m.id === 'm_demo' || m.merchant_code === '999999' || m.merchant_code === 'MC-99');
      if (db.merchants.length === 0) {
        db.merchants.push({
          id: 'm_demo',
          phone: constants.DEFAULTS.DEMO_PHONE,
          password: demoPasswordHash,
          provider: 'paytm',
          upi_id: constants.DEFAULTS.PAYTM_UPI,
          upi_ids: [constants.DEFAULTS.PAYTM_UPI],
          fee_paid: true,
          razorpay_payment_id: 'pay_demo_init',
          status: constants.MERCHANT_STATUS.ACTIVE,
          merchant_code: constants.DEFAULTS.DEMO_MERCHANT_CODE,
          user_codes: [constants.DEFAULTS.DEMO_MERCHANT_CODE, 'MC-99'],
          is_demo: true,
          created_at: new Date().toISOString()
        });
      }
    } else {
      db.merchants = [];
    }
    db.transactions = [];
    writeDb(db);
    return { merchantsCount: db.merchants.length, transactionsCount: db.transactions.length };
  },

  verifyPassword(merchant, password) {
    if (!merchant || !merchant.password) return false;
    return bcrypt.compareSync(password, merchant.password);
  }
};

module.exports = MerchantStore;
