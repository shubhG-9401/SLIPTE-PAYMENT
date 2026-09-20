const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

let DATA_DIR = path.join(__dirname, 'data');
let DB_FILE = path.join(DATA_DIR, 'database.json');

try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (e) {
  // Read-only filesystem fallback (e.g. Vercel, AWS Lambda, containers)
  try {
    DATA_DIR = path.join('/tmp', 'data');
    DB_FILE = path.join(DATA_DIR, 'database.json');
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (err) {
    console.warn('Filesystem read-only, will operate using in-memory store.');
  }
}

// Initial structure with Default Admin and Seed Demo Merchant
const defaultAdminPassword = bcrypt.hashSync('admin123', 8);
const demoMerchantPassword = bcrypt.hashSync('demo123', 8);

const initialData = {
  merchants: [
    {
      id: 'm_demo',
      phone: '9999999999',
      password: demoMerchantPassword,
      provider: 'paytm',
      upi_id: 'merchant@paytm',
      fee_paid: true,
      razorpay_payment_id: 'pay_demo_init',
      status: 'active',
      merchant_code: 'MC-99',
      user_codes: ['MC-99'],
      is_demo: true,
      created_at: new Date().toISOString()
    }
  ],
  transactions: [],
  admins: [
    {
      id: 'admin_1',
      username: 'admin',
      password: defaultAdminPassword,
      created_at: new Date().toISOString()
    }
  ]
};

let memoryCache = null;

function readDb() {
  if (memoryCache) {
    return memoryCache;
  }
  try {
    if (!fs.existsSync(DB_FILE)) {
      writeDb(initialData);
      return initialData;
    }

    const content = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(content);

    // Ensure demo merchant always exists
    let modified = false;
    if (!parsed.merchants) {
      parsed.merchants = [];
      modified = true;
    }
    if (!parsed.merchants.some(m => m.merchant_code === 'MC-99' || m.id === 'm_demo')) {
      parsed.merchants.unshift({
        id: 'm_demo',
        phone: '9999999999',
        password: demoMerchantPassword,
        provider: 'paytm',
        upi_id: 'merchant@paytm',
        fee_paid: true,
        razorpay_payment_id: 'pay_demo_init',
        status: 'active',
        merchant_code: 'MC-99',
        user_codes: ['MC-99'],
        is_demo: true,
        created_at: new Date().toISOString()
      });
      modified = true;
    }
    if (modified) {
      writeDb(parsed);
    }
    memoryCache = parsed;
    return parsed;
  } catch (err) {
    console.error('Error reading database:', err);
    memoryCache = initialData;
    return initialData;
  }
}

function writeDb(data) {
  memoryCache = data;
  try {
    const tempFile = DB_FILE + '.tmp';
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempFile, DB_FILE);
  } catch (err) {
    console.warn('Filesystem write bypassed (using memory cache):', err.message);
  }
}


// Helper: Generate unique merchant code formatted like MC-99, MC-101, etc.
function generateMerchantCode(existingMerchants = []) {
  let maxNum = 98;
  for (const m of existingMerchants) {
    if (m.merchant_code && m.merchant_code.startsWith('MC-')) {
      const num = parseInt(m.merchant_code.replace('MC-', ''), 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }
  return `MC-${maxNum + 1}`;
}

function generateCode(prefix = 'UPI') {
  return generateMerchantCode();
}

// Format the exact UPI URI required by the specification:
// upi://pay?pa=MERCHANT_UPI_ID&am=ENTERED_AMOUNT&cu=INR&tn=Verified Merchant Account
function buildUpiUri(upiId, amount) {
  const formattedAmt = Number(amount).toFixed(2).replace(/\.00$/, '');
  const cleanUpi = (upiId || 'merchant@paytm').trim();
  return `upi://pay?pa=${cleanUpi}&am=${formattedAmt}&cu=INR&tn=Verified Merchant Account`;
}

// Helper: Split amount into chunks <= 1999
function splitAmount(total) {
  const MAX_CHUNK = 1999;
  const numTotal = Math.round(Number(total) * 100) / 100;
  if (numTotal <= MAX_CHUNK) {
    return [numTotal];
  }
  const splits = [];
  let remaining = numTotal;
  while (remaining > 0) {
    if (remaining > MAX_CHUNK) {
      splits.push(MAX_CHUNK);
      remaining = Math.round((remaining - MAX_CHUNK) * 100) / 100;
    } else {
      splits.push(remaining);
      remaining = 0;
    }
  }
  return splits;
}

// Helper: Normalize phone numbers (strips country code +91, non-digits, keeps last 10 digits)
function normalizePhone(raw) {
  if (!raw) return '';
  const digits = raw.toString().replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

// Merchant methods
const MerchantStore = {
  create({ phone, password, provider, upi_id, fee_paid = true, razorpay_payment_id = null }) {
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

    const newMerchant = {
      id: 'm_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      phone: cleanPhone,
      password: passwordHash,
      provider: provider || 'paytm',
      upi_id,
      fee_paid: !!fee_paid,
      razorpay_payment_id: razorpay_payment_id || null,
      status: 'active', // can be 'active', 'blocked'
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
    let demo = db.merchants.find(m => m.merchant_code === 'MC-99' || m.id === 'm_demo');
    if (!demo) {
      demo = {
        id: 'm_demo',
        phone: '9999999999',
        password: demoMerchantPassword,
        provider: 'paytm',
        upi_id: 'merchant@paytm',
        fee_paid: true,
        razorpay_payment_id: 'pay_demo_init',
        status: 'active',
        merchant_code: 'MC-99',
        user_codes: ['MC-99'],
        is_demo: true,
        created_at: new Date().toISOString()
      };
      db.merchants.unshift(demo);
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
      merchant.status = 'active';
      if (password) {
        const salt = bcrypt.genSaltSync(8);
        merchant.password = bcrypt.hashSync(password, salt);
      }
      if (upi_id) merchant.upi_id = upi_id;
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
      merchant.status = 'active';
      if (password) {
        const salt = bcrypt.genSaltSync(8);
        merchant.password = bcrypt.hashSync(password, salt);
      }
      if (upi_id) merchant.upi_id = upi_id;
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
    return db.merchants.find(m => normalizePhone(m.phone) === cleanPhone);
  },

  findById(id) {
    const db = readDb();
    return db.merchants.find(m => m.id === id);
  },

  findByMerchantCode(code) {
    const db = readDb();
    const cleanCode = (code || '').trim().toUpperCase();
    return db.merchants.find(m => 
      (m.merchant_code && m.merchant_code.toUpperCase() === cleanCode) ||
      (Array.isArray(m.user_codes) && m.user_codes.some(c => c.toUpperCase() === cleanCode))
    );
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

  updateUpi(id, upiId) {
    const db = readDb();
    const merchant = db.merchants.find(m => m.id === id);
    if (!merchant) return null;
    merchant.upi_id = upiId.trim();
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
      db.merchants = db.merchants.filter(m => m.is_demo === true || m.id === 'm_demo' || m.merchant_code === 'MC-99');
      if (db.merchants.length === 0) {
        db.merchants.push({
          id: 'm_demo',
          phone: '9999999999',
          password: demoMerchantPassword,
          provider: 'paytm',
          upi_id: 'paytm.s1m66cw@pty',
          fee_paid: true,
          razorpay_payment_id: 'pay_demo_init',
          status: 'active',
          merchant_code: 'MC-99',
          user_codes: ['MC-99'],
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
    return bcrypt.compareSync(password, merchant.password);
  }
};

function sanitizeMerchant(m) {
  if (!m) return null;
  const { password, ...safe } = m;
  if (!safe.merchant_code && safe.user_codes && safe.user_codes[0]) {
    safe.merchant_code = safe.user_codes[0];
  }
  return safe;
}

// Transaction methods with Sequential Payload Queue
const TransactionStore = {
  create({ merchant_id, user_code, total_amount, upi_id }) {
    const db = readDb();
    const merchant = db.merchants.find(m => m.id === merchant_id);
    if (!merchant) throw new Error('Merchant not found');

    if (upi_id && typeof upi_id === 'string' && upi_id.trim() && upi_id.includes('@')) {
      merchant.upi_id = upi_id.trim();
    }
    const merchantUpi = merchant.upi_id || 'merchant@paytm';

    const splitValues = splitAmount(total_amount);
    const merchantCode = merchant.merchant_code || (merchant.user_codes && merchant.user_codes[0]) || 'MC-99';
    const chunks = splitValues.map((amt, idx) => {
      return {
        part_index: idx + 1,
        total_parts: splitValues.length,
        amount: amt,
        upi_uri: buildUpiUri(merchantUpi, amt),
        status: idx === 0 ? 'pending' : 'queued',
        approved_at: null,
        denied_at: null
      };
    });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 120 * 1000); // 2 minutes (120 seconds)

    const newTxn = {
      id: 'txn_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      merchant_id,
      merchant_code: merchantCode,
      user_code: user_code || merchantCode,
      merchant_upi_id: merchant.upi_id,
      merchant_phone: merchant.phone,
      total_amount: Number(total_amount),
      split_count: splitValues.length,
      current_part_index: 1, // 1-indexed
      chunks,
      splits: chunks, // for backward compatibility
      status: 'pending', // 'pending', 'approved', 'denied', 'expired'
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
    return db.transactions.find(t => t.id === id);
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
    if (txn.status !== 'pending' && txn.status !== 'submitted') {
      throw new Error(`Transaction is already ${txn.status}`);
    }

    const currentIdx = (txn.current_part_index || 1) - 1;
    const currentChunk = txn.chunks[currentIdx];
    if (!currentChunk) throw new Error('Invalid chunk index');

    currentChunk.status = 'approved';
    currentChunk.approved_at = new Date().toISOString();
    txn.approved_amount = (txn.approved_amount || 0) + currentChunk.amount;

    const hasNextChunk = txn.current_part_index < txn.split_count;

    if (hasNextChunk) {
      txn.current_part_index += 1;
      const nextIdx = txn.current_part_index - 1;
      txn.chunks[nextIdx].status = 'pending';
      // Restart 2-minute timer for next chunk
      txn.expires_at = new Date(Date.now() + 120 * 1000).toISOString();
      txn.status = 'pending';

      writeDb(db);
      return {
        completed: false,
        approvedChunk: currentChunk,
        nextChunk: txn.chunks[nextIdx],
        txn
      };
    } else {
      txn.status = 'approved';
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
      txn.chunks[currentIdx].status = 'denied';
      txn.chunks[currentIdx].denied_at = new Date().toISOString();
    }
    txn.status = 'denied';
    txn.denied_at = new Date().toISOString();

    writeDb(db);
    return txn;
  },

  expireTransaction(id) {
    const db = readDb();
    const txn = db.transactions.find(t => t.id === id);
    if (!txn) throw new Error('Transaction not found');

    const currentIdx = (txn.current_part_index || 1) - 1;
    if (txn.chunks && txn.chunks[currentIdx] && txn.chunks[currentIdx].status === 'pending') {
      txn.chunks[currentIdx].status = 'expired';
    }
    txn.status = 'expired';

    writeDb(db);
    return txn;
  },

  updateStatus(id, status) {
    if (status === 'approved') return this.approveCurrentChunk(id).txn;
    if (status === 'denied') return this.denyTransaction(id);
    if (status === 'expired') return this.expireTransaction(id);

    const db = readDb();
    const txn = db.transactions.find(t => t.id === id);
    if (!txn) throw new Error('Transaction not found');
    txn.status = status;
    writeDb(db);
    return txn;
  }
};

// Admin methods
const AdminStore = {
  login(username, password) {
    const db = readDb();
    const admin = db.admins.find(a => a.username === username);
    if (!admin) return null;
    if (bcrypt.compareSync(password, admin.password)) {
      return { id: admin.id, username: admin.username };
    }
    return null;
  },

  updateCredentials(adminId, { currentPassword, newUsername, newPassword }) {
    const db = readDb();
    const admin = db.admins.find(a => a.id === adminId || a.username === adminId) || db.admins[0];
    if (!admin) throw new Error('Admin account not found');

    if (currentPassword && !bcrypt.compareSync(currentPassword, admin.password)) {
      throw new Error('Current password does not match');
    }

    if (newUsername && newUsername.trim()) {
      const cleanUsername = newUsername.trim();
      const existing = db.admins.find(a => a.username.toLowerCase() === cleanUsername.toLowerCase() && a.id !== admin.id);
      if (existing) {
        throw new Error(`Username "${cleanUsername}" is already taken`);
      }
      admin.username = cleanUsername;
    }

    if (newPassword && newPassword.trim()) {
      if (newPassword.trim().length < 4) {
        throw new Error('New password must be at least 4 characters');
      }
      admin.password = bcrypt.hashSync(newPassword.trim(), 8);
    }

    admin.updated_at = new Date().toISOString();
    writeDb(db);
    return { id: admin.id, username: admin.username };
  },

  getProfile(adminId) {
    const db = readDb();
    const admin = db.admins.find(a => a.id === adminId || a.username === adminId) || db.admins[0];
    if (!admin) return null;
    return { id: admin.id, username: admin.username, created_at: admin.created_at };
  }
};

module.exports = {
  MerchantStore,
  TransactionStore,
  AdminStore,
  splitAmount,
  buildUpiUri,
  sanitizeMerchant,
  normalizePhone
};
