const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { WebSocketServer, WebSocket } = require('ws');
const QRCode = require('qrcode');
const { MerchantStore, TransactionStore, AdminStore, sanitizeMerchant, normalizePhone } = require('./db');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static assets
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')));
app.use('/merchant', express.static(path.join(__dirname, 'public', 'merchant')));
app.use('/user', express.static(path.join(__dirname, 'public', 'user')));
app.use('/shared', express.static(path.join(__dirname, 'public', 'shared')));
app.use(express.static(path.join(__dirname, 'public')));

// ----------------------------------------------------
// Real-time WebSocket Connection Manager
// ----------------------------------------------------
// merchantSockets: merchantId -> Set of ws
const merchantSockets = new Map();
// userSockets: userCode (uppercase) -> Set of ws
const userSockets = new Map();

function broadcastToMerchant(merchantId, data) {
  const sockets = merchantSockets.get(merchantId);
  if (sockets) {
    const payload = JSON.stringify(data);
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }
}

function broadcastToUserCode(userCode, data) {
  const cleanCode = (userCode || '').trim().toUpperCase();
  const sockets = userSockets.get(cleanCode);
  if (sockets) {
    const payload = JSON.stringify(data);
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }
}

// HTTP Polling fallback tracking for Serverless (e.g. Vercel)
// userPollers: userCode -> Map(sessionId -> lastSeenTimestamp)
const userPollers = new Map();

function cleanStalePollers() {
  const now = Date.now();
  for (const [code, sessions] of userPollers.entries()) {
    for (const [sessionId, ts] of sessions.entries()) {
      if (now - ts > 12000) {
        sessions.delete(sessionId);
      }
    }
    if (sessions.size === 0) userPollers.delete(code);
  }
}

function getSlotStatus(merchant) {
  if (!merchant) return { code: 'MC-99', connectedCount: 0, maxSlots: 2, slotText: '0/2', slots: [] };
  const code = (merchant.merchant_code || (merchant.user_codes && merchant.user_codes[0]) || 'MC-99').toUpperCase();
  cleanStalePollers();
  const sockets = userSockets.get(code);
  const wsCount = sockets ? sockets.size : 0;
  const pollSessions = userPollers.get(code);
  const pollCount = pollSessions ? pollSessions.size : 0;
  const count = Math.min(2, Math.max(wsCount, pollCount));
  return {
    code,
    connectedCount: count,
    maxSlots: 2,
    slotText: `${count}/2`,
    slots: [
      { code, connected: count > 0, activeUsers: count }
    ]
  };
}


wss.on('connection', (ws) => {
  let boundRole = null;
  let boundMerchantId = null;
  let boundUserCode = null;

  ws.on('message', (messageRaw) => {
    try {
      const data = JSON.parse(messageRaw);

      if (data.type === 'merchant_init') {
        boundRole = 'merchant';
        boundMerchantId = data.merchantId;
        if (!merchantSockets.has(boundMerchantId)) {
          merchantSockets.set(boundMerchantId, new Set());
        }
        merchantSockets.get(boundMerchantId).add(ws);

        const merchant = MerchantStore.findById(boundMerchantId);
        if (merchant) {
          const slotInfo = getSlotStatus(merchant);
          ws.send(JSON.stringify({
            type: 'merchant_ready',
            slotInfo: slotInfo,
            slots: slotInfo.slots
          }));
        }
      } else if (data.type === 'user_init') {
        const code = (data.userCode || '').trim().toUpperCase();
        const merchant = MerchantStore.findByMerchantCode(code);

        if (!merchant) {
          ws.send(JSON.stringify({
            type: 'user_error',
            message: 'Invalid unique code. No merchant associated with this code.'
          }));
          return;
        }

        if (merchant.status === 'blocked') {
          ws.send(JSON.stringify({
            type: 'user_error',
            message: 'Merchant account is currently blocked by Admin.'
          }));
          return;
        }

        const merchantCode = (merchant.merchant_code || (merchant.user_codes && merchant.user_codes[0]) || code).toUpperCase();
        const existingSockets = userSockets.get(merchantCode) || new Set();

        // Enforce maximum 2 distinct users per merchant code
        if (existingSockets.size >= 2 && !existingSockets.has(ws)) {
          ws.send(JSON.stringify({
            type: 'user_error',
            message: `Pairing limit reached: Maximum 2 users already connected to merchant ${merchantCode}.`
          }));
          return;
        }

        boundRole = 'user';
        boundUserCode = merchantCode;
        boundMerchantId = merchant.id;

        if (!userSockets.has(merchantCode)) {
          userSockets.set(merchantCode, new Set());
        }
        userSockets.get(merchantCode).add(ws);

        const slotInfo = getSlotStatus(merchant);

        // Notify user of successful pairing
        ws.send(JSON.stringify({
          type: 'user_ready',
          merchantPhone: merchant.phone.replace(/(\d{2})\d{4}(\d{4})/, '$1****$2'),
          merchantUpi: merchant.upi_id,
          code: merchantCode,
          slotText: slotInfo.slotText
        }));

        // Notify merchant that slot count updated
        broadcastToMerchant(merchant.id, {
          type: 'slot_updated',
          slotInfo: slotInfo,
          slots: slotInfo.slots
        });

        // Check if there is an active pending transaction for this merchant code
        const latestTxn = TransactionStore.getLatestForCode(merchantCode);
        if (latestTxn && (latestTxn.status === 'pending' || latestTxn.status === 'submitted')) {
          const now = Date.now();
          const exp = new Date(latestTxn.expires_at).getTime();
          if (exp > now) {
            const currentIdx = (latestTxn.current_part_index || 1) - 1;
            const currentChunk = (latestTxn.chunks && latestTxn.chunks[currentIdx]) || null;
            ws.send(JSON.stringify({
              type: 'active_payment',
              transaction: latestTxn,
              chunk: currentChunk,
              currentPart: latestTxn.current_part_index || 1,
              totalParts: latestTxn.split_count || 1,
              remainingSeconds: Math.max(0, Math.floor((exp - now) / 1000))
            }));
          }
        }
      }
    } catch (err) {
      console.error('WebSocket message parsing error:', err);
    }
  });

  ws.on('close', () => {
    if (boundRole === 'merchant' && boundMerchantId) {
      const sockets = merchantSockets.get(boundMerchantId);
      if (sockets) {
        sockets.delete(ws);
        if (sockets.size === 0) merchantSockets.delete(boundMerchantId);
      }
    } else if (boundRole === 'user' && boundUserCode) {
      const sockets = userSockets.get(boundUserCode);
      if (sockets) {
        sockets.delete(ws);
        if (sockets.size === 0) userSockets.delete(boundUserCode);
      }
      if (boundMerchantId) {
        const merchant = MerchantStore.findById(boundMerchantId);
        if (merchant) {
          const slotInfo = getSlotStatus(merchant);
          broadcastToMerchant(boundMerchantId, {
            type: 'slot_updated',
            slotInfo: slotInfo,
            slots: slotInfo.slots
          });
        }
      }
    }
  });
});

// Periodic timer to expire pending transactions
setInterval(() => {
  const txns = TransactionStore.getAll();
  const now = Date.now();
  for (const txn of txns) {
    if ((txn.status === 'pending' || txn.status === 'submitted') && new Date(txn.expires_at).getTime() < now) {
      TransactionStore.updateStatus(txn.id, 'expired');
      broadcastToUserCode(txn.user_code, {
        type: 'payment_expired',
        txnId: txn.id
      });
      broadcastToMerchant(txn.merchant_id, {
        type: 'payment_expired',
        txnId: txn.id
      });
    }
  }
}, 3000);

// ----------------------------------------------------
// REST APIs
// ----------------------------------------------------

// QR Code Generator API
app.get('/api/qr', async (req, res) => {
  const { text } = req.query;
  if (!text) {
    return res.status(400).json({ error: 'Text query parameter is required' });
  }
  try {
    const dataUrl = await QRCode.toDataURL(text, {
      width: 320,
      margin: 2,
      color: {
        dark: '#002970',
        light: '#ffffff'
      }
    });
    res.json({ dataUrl });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// Razorpay Web Form Callback (When Razorpay Button automatically submits form)
app.post('/api/merchant/razorpay-callback', (req, res) => {
  try {
    const { razorpay_payment_id, phone, upi_id, password, provider } = req.body;
    console.log('Razorpay callback received:', { razorpay_payment_id, phone, upi_id });

    if (!razorpay_payment_id) {
      return res.status(400).send('<h3>Payment ID missing from Razorpay callback</h3><a href="/merchant">Return to Merchant Portal</a>');
    }

    if (phone && upi_id) {
      const merchant = MerchantStore.verifyOrRegisterRazorpay({
        phone: phone.trim(),
        password: password || 'paytm123',
        provider: provider || 'paytm',
        upi_id: upi_id.trim(),
        razorpay_payment_id
      });

      return res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Payment Verified - Merchant Hub</title></head>
        <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; text-align: center; padding: 60px 20px; background: #f0f7ff;">
          <div style="max-width: 460px; margin: 0 auto; background: #ffffff; padding: 30px; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">
            <div style="font-size: 3rem; color: #10b981;">✓</div>
            <h2 style="color: #002970; margin-top: 10px;">Payment Verified!</h2>
            <p style="color: #475569; margin: 10px 0 20px;">₹50 Registration fee verified by Razorpay.<br><code>${razorpay_payment_id}</code></p>
            <p style="color: #0284c7; font-weight: 600;">Redirecting to your Merchant Dashboard...</p>
          </div>
          <script>
            const merchant = ${JSON.stringify(sanitizeMerchant(merchant))};
            localStorage.setItem('merchant_session', JSON.stringify(merchant));
            localStorage.removeItem('pending_merchant_reg');
            setTimeout(() => {
              window.location.href = '/merchant?payment_verified=true';
            }, 1200);
          </script>
        </body>
        </html>
      `);
    } else {
      return res.redirect(`/merchant?razorpay_payment_id=${encodeURIComponent(razorpay_payment_id)}`);
    }
  } catch (err) {
    console.error('Razorpay callback error:', err);
    res.status(500).send(`<h3>Error processing Razorpay callback: ${err.message}</h3><a href="/merchant">Back to Registration</a>`);
  }
});

// Automatic AJAX verification for Razorpay
app.post('/api/merchant/verify-razorpay', (req, res) => {
  try {
    const { razorpay_payment_id, phone, upi_id, password, provider } = req.body;
    if (!razorpay_payment_id) {
      return res.status(400).json({ error: 'Razorpay Payment ID is required' });
    }
    if (!phone || !upi_id) {
      return res.status(400).json({ error: 'Phone number and UPI ID are required' });
    }

    const merchant = MerchantStore.verifyOrRegisterRazorpay({
      phone: phone.trim(),
      password: password || 'paytm123',
      provider: provider || 'paytm',
      upi_id: upi_id.trim(),
      razorpay_payment_id
    });

    res.json({
      success: true,
      message: 'Razorpay payment verified successfully',
      merchant: sanitizeMerchant(merchant)
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Direct UPI verification for ₹50 registration fee
app.post('/api/merchant/verify-upi', (req, res) => {
  try {
    const { phone, upi_id, password, provider, utr } = req.body;
    if (!phone || !upi_id) {
      return res.status(400).json({ error: 'Phone number and UPI ID are required' });
    }

    const merchant = MerchantStore.verifyUpiPayment({
      phone: phone.trim(),
      password: password || 'paytm123',
      provider: provider || 'paytm',
      upi_id: upi_id.trim(),
      utr: utr || ('UPI' + Date.now().toString().slice(-6))
    });

    res.json({
      success: true,
      message: 'UPI payment verified successfully',
      merchant: sanitizeMerchant(merchant)
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Merchant Authentication & Registration
app.post('/api/merchant/register', (req, res) => {
  try {
    const { phone, password, provider, upi_id, fee_paid, razorpay_payment_id } = req.body;
    const cleanPhone = normalizePhone(phone);
    if (!cleanPhone || cleanPhone.length !== 10) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number' });
    }
    if (!password || password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }
    if (!upi_id || !upi_id.includes('@')) {
      return res.status(400).json({ error: 'Please enter a valid UPI ID (e.g. yourname@paytm)' });
    }
    if (provider && provider !== 'paytm') {
      return res.status(400).json({ error: 'Only Paytm is currently live. Other providers are coming soon.' });
    }

    const merchant = MerchantStore.create({
      phone: cleanPhone,
      password,
      provider: provider || 'paytm',
      upi_id: upi_id.trim(),
      fee_paid: fee_paid !== false,
      razorpay_payment_id: razorpay_payment_id || null
    });

    res.json({ success: true, merchant });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/merchant/login', (req, res) => {
  try {
    const { phone, password } = req.body;
    const cleanPhone = normalizePhone(phone);
    if (!cleanPhone || !password) {
      return res.status(400).json({ error: 'Phone and password are required' });
    }
    const merchant = MerchantStore.findByPhone(cleanPhone);
    if (!merchant) {
      return res.status(401).json({ error: 'No merchant found with this phone number. Please register first.' });
    }
    if (!MerchantStore.verifyPassword(merchant, password)) {
      return res.status(401).json({ error: 'Incorrect password. Please try again or reset via Admin.' });
    }
    if (merchant.status === 'blocked') {
      return res.status(403).json({ error: 'Your merchant account is blocked by the administrator.' });
    }

    res.json({ success: true, merchant: sanitizeMerchant(merchant) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/merchant/me/:id', (req, res) => {
  const merchant = MerchantStore.findById(req.params.id);
  if (!merchant) {
    return res.status(404).json({ error: 'Merchant not found' });
  }
  const safe = sanitizeMerchant(merchant);
  safe.slots = getSlotStatus(merchant);
  safe.slotInfo = getSlotStatus(merchant);
  res.json({ success: true, merchant: safe });
});

// Demo Merchant Endpoint (bypasses auth for sandbox testing)
app.get('/api/merchant/demo', (req, res) => {
  try {
    const demo = MerchantStore.getDemoMerchant();
    const safe = sanitizeMerchant(demo);
    safe.slots = getSlotStatus(demo);
    safe.slotInfo = getSlotStatus(demo);
    res.json({ success: true, merchant: safe });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/merchant/regenerate-codes', (req, res) => {
  const { merchantId } = req.body;
  if (!merchantId) return res.status(400).json({ error: 'merchantId required' });
  try {
    const newCodes = MerchantStore.regenerateUserCodes(merchantId);
    const merchant = MerchantStore.findById(merchantId);
    res.json({ success: true, user_codes: newCodes, slots: getSlotStatus(merchant) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Merchant initiates payment request
app.post('/api/merchant/update-upi', (req, res) => {
  try {
    const { merchantId, upi_id } = req.body;
    if (!merchantId || !upi_id || !upi_id.includes('@')) {
      return res.status(400).json({ error: 'Valid merchantId and destination UPI ID containing @ are required' });
    }
    const updated = MerchantStore.updateUpi(merchantId, upi_id);
    if (!updated) return res.status(404).json({ error: 'Merchant not found' });
    res.json({ success: true, merchant: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/merchant/payment-request', (req, res) => {
  try {
    const { merchantId, targetSlotCode, amount, upi_id } = req.body;
    if (!merchantId || !amount || Number(amount) <= 0) {
      return res.status(400).json({ error: 'Valid merchantId and positive amount are required' });
    }
    const merchant = MerchantStore.findById(merchantId);
    if (!merchant) return res.status(404).json({ error: 'Merchant not found' });
    if (merchant.status === 'blocked') return res.status(403).json({ error: 'Merchant account is blocked' });

    const targetCode = (targetSlotCode || merchant.merchant_code || (merchant.user_codes && merchant.user_codes[0]) || 'MC-99').toUpperCase();

    const txn = TransactionStore.create({
      merchant_id: merchantId,
      user_code: targetCode,
      total_amount: Number(amount),
      upi_id
    });

    const currentChunk = txn.chunks[0];

    // Notify connected user(s) on targetCode with payload 1
    broadcastToUserCode(targetCode, {
      type: 'payment_incoming',
      transaction: txn,
      chunk: currentChunk,
      currentPart: 1,
      totalParts: txn.split_count,
      remainingSeconds: 120
    });

    // Notify merchant
    broadcastToMerchant(merchantId, {
      type: 'payment_pending',
      transaction: txn,
      chunk: currentChunk
    });

    res.json({ success: true, transaction: txn });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Merchant payment approval/denial action with Sequential Chunk Progression
app.post('/api/merchant/payment-action', (req, res) => {
  try {
    const { merchantId, txnId, action } = req.body;
    if (!merchantId || !txnId || !action) {
      return res.status(400).json({ error: 'merchantId, txnId, and action are required' });
    }
    if (!['approve', 'deny'].includes(action)) {
      return res.status(400).json({ error: 'Action must be approve or deny' });
    }

    const txn = TransactionStore.findById(txnId);
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });
    if (txn.merchant_id !== merchantId) return res.status(403).json({ error: 'Unauthorized' });

    const targetCode = (txn.merchant_code || txn.user_code || '').toUpperCase();

    if (action === 'approve') {
      const result = TransactionStore.approveCurrentChunk(txnId);

      if (!result.completed) {
        // Condition B: Multi-split transaction - sequential push of next chunk
        broadcastToUserCode(targetCode, {
          type: 'chunk_approved_next',
          approvedChunk: result.approvedChunk,
          nextChunk: result.nextChunk,
          transaction: result.txn,
          currentPart: result.txn.current_part_index,
          totalParts: result.txn.split_count,
          remainingSeconds: 120
        });

        broadcastToMerchant(merchantId, {
          type: 'chunk_approved',
          transaction: result.txn,
          approvedChunk: result.approvedChunk,
          nextChunk: result.nextChunk
        });

        return res.json({ success: true, completed: false, transaction: result.txn, nextChunk: result.nextChunk });
      } else {
        // All chunks completed and approved
        broadcastToUserCode(targetCode, {
          type: 'payment_decision',
          txnId,
          status: 'approved',
          message: 'Payment Approved by Merchant! Thank you.',
          transaction: result.txn
        });

        broadcastToMerchant(merchantId, {
          type: 'payment_decision_confirmed',
          transaction: result.txn
        });

        return res.json({ success: true, completed: true, transaction: result.txn });
      }
    } else {
      // Denial action
      const deniedTxn = TransactionStore.denyTransaction(txnId);

      broadcastToUserCode(targetCode, {
        type: 'payment_decision',
        txnId,
        status: 'denied',
        message: 'Payment Denied by Merchant.',
        transaction: deniedTxn
      });

      broadcastToMerchant(merchantId, {
        type: 'payment_decision_confirmed',
        transaction: deniedTxn
      });

      return res.json({ success: true, transaction: deniedTxn });
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Merchant Transactions & Statistics
app.get('/api/merchant/transactions/:id', (req, res) => {
  try {
    const txns = TransactionStore.getByMerchant(req.params.id);
    res.json({ success: true, transactions: txns });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/merchant/stats/:id', (req, res) => {
  try {
    const merchant = MerchantStore.findById(req.params.id);
    if (!merchant) return res.status(404).json({ error: 'Merchant not found' });

    const txns = TransactionStore.getByMerchant(req.params.id);
    const approvedTxns = txns.filter(t => t.status === 'approved' || (t.approved_amount && t.approved_amount > 0));
    const fullyApproved = txns.filter(t => t.status === 'approved');
    const deniedTxns = txns.filter(t => t.status === 'denied');

    const totalRevenue = txns.reduce((sum, t) => sum + (t.approved_amount || (t.status === 'approved' ? t.total_amount : 0)), 0);

    const todayStr = new Date().toISOString().slice(0, 10);
    const todayApproved = txns.filter(t => (t.approved_at || t.created_at).startsWith(todayStr));
    const todayRevenue = todayApproved.reduce((sum, t) => sum + (t.approved_amount || (t.status === 'approved' ? t.total_amount : 0)), 0);

    const slotInfo = getSlotStatus(merchant);

    res.json({
      success: true,
      stats: {
        totalRevenue,
        todayRevenue,
        totalTransactions: txns.length,
        approvedCount: fullyApproved.length,
        deniedCount: deniedTxns.length,
        pendingCount: txns.filter(t => t.status === 'pending' || t.status === 'submitted').length,
        slots: slotInfo.slots,
        slotInfo: slotInfo
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// User APIs
// ----------------------------------------------------
app.get('/api/user/validate-code/:code', (req, res) => {
  try {
    const code = req.params.code;
    const merchant = MerchantStore.findByUserCode(code);
    if (!merchant) {
      return res.status(404).json({ valid: false, error: 'Invalid pairing code' });
    }
    if (merchant.status === 'blocked') {
      return res.status(403).json({ valid: false, error: 'Merchant account is blocked' });
    }
    res.json({
      valid: true,
      merchant: {
        phone: merchant.phone.replace(/(\d{2})\d{4}(\d{4})/, '$1****$2'),
        upi_id: merchant.upi_id,
        provider: merchant.provider
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// User Terminal HTTP Polling Endpoint (Fallback for Serverless / Vercel without WebSockets)
app.get('/api/user/poll/:code', (req, res) => {
  try {
    const rawCode = req.params.code;
    const cleanCode = (rawCode || '').trim().toUpperCase();
    const sessionId = req.query.sessionId || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'sess_' + cleanCode;

    const merchant = MerchantStore.findByUserCode(cleanCode) || MerchantStore.findByMerchantCode(cleanCode);
    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found' });
    }

    if (merchant.status === 'blocked') {
      return res.json({ success: false, blocked: true, message: 'Merchant account has been blocked by administrator.' });
    }

    // Register active polling heartbeat for slot status
    if (!userPollers.has(cleanCode)) {
      userPollers.set(cleanCode, new Map());
    }
    userPollers.get(cleanCode).set(sessionId, Date.now());

    // Check latest transaction
    const latestTxn = TransactionStore.getLatestForCode(cleanCode);
    let activePayment = null;

    if (latestTxn) {
      const now = Date.now();
      const exp = new Date(latestTxn.expires_at).getTime();

      if ((latestTxn.status === 'pending' || latestTxn.status === 'submitted') && exp > now) {
        const currentIdx = (latestTxn.current_part_index || 1) - 1;
        const currentChunk = (latestTxn.chunks && latestTxn.chunks[currentIdx]) || null;
        activePayment = {
          type: 'active_payment',
          transaction: latestTxn,
          chunk: currentChunk,
          currentPart: latestTxn.current_part_index || 1,
          totalParts: latestTxn.split_count || 1,
          remainingSeconds: Math.max(0, Math.floor((exp - now) / 1000))
        };
      } else if (latestTxn.status === 'approved' || latestTxn.status === 'denied') {
        const updatedTime = new Date(latestTxn.updated_at || latestTxn.created_at).getTime();
        if (now - updatedTime < 25000) {
          activePayment = {
            type: 'payment_decision',
            transaction: latestTxn,
            status: latestTxn.status,
            message: latestTxn.status === 'approved' ? 'Payment Approved by Merchant! Thank you.' : 'Payment Denied by Merchant.'
          };
        }
      }
    }

    res.json({
      success: true,
      code: cleanCode,
      merchant: {
        phone: merchant.phone.replace(/(\d{2})\d{4}(\d{4})/, '$1****$2'),
        upi_id: merchant.upi_id,
        provider: merchant.provider,
        status: merchant.status
      },
      activePayment
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.post('/api/user/submit-payment', (req, res) => {
  try {
    const { txnId, utr } = req.body;
    const txn = TransactionStore.findById(txnId);
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });
    if (txn.status !== 'pending') {
      return res.status(400).json({ error: `Transaction is already ${txn.status}` });
    }

    const updated = TransactionStore.updateStatus(txnId, 'submitted');
    if (utr) updated.utr = utr;

    // Notify Merchant
    broadcastToMerchant(txn.merchant_id, {
      type: 'user_submitted_payment',
      txnId,
      userCode: txn.user_code,
      totalAmount: txn.total_amount,
      utr: utr || 'Not provided'
    });

    res.json({ success: true, transaction: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ----------------------------------------------------
// Admin APIs
// ----------------------------------------------------
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const admin = AdminStore.login(username, password);
  if (!admin) {
    return res.status(401).json({ error: 'Invalid admin username or password' });
  }
  res.json({ success: true, admin });
});

app.get('/api/admin/merchants', (req, res) => {
  const merchants = MerchantStore.getAll();
  const txns = TransactionStore.getAll();
  const enriched = merchants.map(m => {
    const mTxns = txns.filter(t => t.merchant_id === m.id);
    const approved = mTxns.filter(t => t.status === 'approved');
    const revenue = approved.reduce((acc, t) => acc + t.total_amount, 0);
    return {
      ...m,
      transactionCount: mTxns.length,
      revenue,
      slots: getSlotStatus(m)
    };
  });
  res.json({ success: true, merchants: enriched });
});

app.post('/api/admin/merchants/:id/status', (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'blocked'].includes(status)) {
      return res.status(400).json({ error: 'Status must be active or blocked' });
    }
    const updated = MerchantStore.updateStatus(req.params.id, status);

    // If blocked, disconnect user and notify
    if (status === 'blocked') {
      broadcastToMerchant(req.params.id, {
        type: 'merchant_blocked',
        message: 'Your account has been blocked by the administrator.'
      });
      if (updated.user_codes) {
        for (const code of updated.user_codes) {
          broadcastToUserCode(code, {
            type: 'merchant_blocked',
            message: 'Connected merchant has been blocked by administrator.'
          });
        }
      }
    }

    res.json({ success: true, merchant: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/merchants/:id/reset-password', (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }
    MerchantStore.resetPassword(req.params.id, newPassword);
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/admin/stats', (req, res) => {
  const merchants = MerchantStore.getAll();
  const txns = TransactionStore.getAll();
  const approved = txns.filter(t => t.status === 'approved');
  const totalGmv = approved.reduce((sum, t) => sum + t.total_amount, 0);

  res.json({
    success: true,
    stats: {
      totalMerchants: merchants.length,
      activeMerchants: merchants.filter(m => m.status === 'active').length,
      blockedMerchants: merchants.filter(m => m.status === 'blocked').length,
      totalTransactions: txns.length,
      approvedTransactions: approved.length,
      totalGmv
    }
  });
});

app.get('/api/admin/transactions', (req, res) => {
  const txns = TransactionStore.getAll();
  res.json({ success: true, transactions: txns });
});

// Admin Profile: Update own username and/or password
app.post('/api/admin/update-credentials', (req, res) => {
  try {
    const { adminId, currentPassword, newUsername, newPassword } = req.body;
    if (!newUsername && !newPassword) {
      return res.status(400).json({ error: 'Please provide a new username or new password' });
    }
    const updated = AdminStore.updateCredentials(adminId, { currentPassword, newUsername, newPassword });
    res.json({ success: true, admin: updated, message: 'Admin credentials updated successfully' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete specific merchant and their transactions
app.delete('/api/admin/merchants/:id', (req, res) => {
  try {
    const success = MerchantStore.delete(req.params.id);
    if (!success) return res.status(404).json({ error: 'Merchant not found' });
    res.json({ success: true, message: 'Merchant deleted successfully' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Clear all fake data and test transactions
app.post('/api/admin/clear-fake-data', (req, res) => {
  try {
    const keepDemo = req.body.keepDemo !== false;
    const result = MerchantStore.clearFakeData({ keepDemo });
    res.json({ success: true, message: 'Fake data cleared successfully', result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Explicit routes for *.html files
app.get('/merchant.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'merchant', 'index.html'));
});

app.get('/user.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'user', 'index.html'));
});

app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

// Root Landing Page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});



if (require.main === module || !process.env.VERCEL) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`UPI Payment System running on port ${PORT}:`);
    console.log(`- Local PC:       http://localhost:${PORT}`);
    console.log(`- Admin Portal:   http://localhost:${PORT}/admin.html`);
    console.log(`- Merchant:       http://localhost:${PORT}/merchant.html`);
    console.log(`- User Terminal:  http://localhost:${PORT}/user.html`);
  });
}

module.exports = app;


