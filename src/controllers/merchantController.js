/**
 * @file merchantController.js
 * @description Handles merchant requests, authentication, profile queries, payment dispatches, and decisions.
 */

const MerchantStore = require('../storage/merchantStore');
const TransactionStore = require('../storage/transactionStore');
const TerminalStore = require('../storage/terminalStore');
const socketManager = require('../websocket/socketManager');
const constants = require('../config/constants');
const { sanitizeMerchant, normalizePhone } = require('../utils/helpers');

const merchantController = {
  async register(req, res, next) {
    try {
      const { phone, password, provider = 'paytm', upi_id, upi_ids, fee_paid, razorpay_payment_id } = req.body;
      const merchant = MerchantStore.create({
        phone,
        password,
        provider,
        upi_id,
        upi_ids,
        fee_paid: fee_paid !== false,
        razorpay_payment_id: razorpay_payment_id || null
      });
      res.json({ success: true, merchant });
    } catch (err) {
      next(err);
    }
  },

  async login(req, res, next) {
    try {
      const { phone, password } = req.body;
      const cleanPhone = normalizePhone(phone);
      const merchant = MerchantStore.findByPhone(cleanPhone);

      if (!merchant) {
        return res.status(401).json({
          success: false,
          error: 'No merchant found with this phone number. Please register first.'
        });
      }

      if (!MerchantStore.verifyPassword(merchant, password)) {
        return res.status(401).json({
          success: false,
          error: 'Incorrect password. Please try again or reset via Admin.'
        });
      }

      if (merchant.status === constants.MERCHANT_STATUS.BLOCKED) {
        return res.status(403).json({
          success: false,
          error: 'Your merchant account is blocked by the administrator.'
        });
      }

      res.json({ success: true, merchant: sanitizeMerchant(merchant) });
    } catch (err) {
      next(err);
    }
  },

  async getProfile(req, res, next) {
    try {
      const merchant = MerchantStore.findById(req.params.id);
      if (!merchant) {
        return res.status(404).json({ success: false, error: 'Merchant not found' });
      }
      const safe = sanitizeMerchant(merchant);
      const slotInfo = TerminalStore.getSlotStatus(merchant);
      safe.slots = slotInfo.slots;
      safe.slotInfo = slotInfo;
      res.json({ success: true, merchant: safe });
    } catch (err) {
      next(err);
    }
  },

  async getDemo(req, res, next) {
    try {
      const demo = MerchantStore.getDemoMerchant();
      const safe = sanitizeMerchant(demo);
      const slotInfo = TerminalStore.getSlotStatus(demo);
      safe.slots = slotInfo.slots;
      safe.slotInfo = slotInfo;
      res.json({ success: true, merchant: safe });
    } catch (err) {
      next(err);
    }
  },

  async regenerateCodes(req, res, next) {
    try {
      const { merchantId } = req.body;
      if (!merchantId) return res.status(400).json({ success: false, error: 'merchantId required' });
      const newCodes = MerchantStore.regenerateUserCodes(merchantId);
      const merchant = MerchantStore.findById(merchantId);
      res.json({
        success: true,
        user_codes: newCodes,
        slots: TerminalStore.getSlotStatus(merchant)
      });
    } catch (err) {
      next(err);
    }
  },

  async updateUpi(req, res, next) {
    try {
      const { merchantId, upi_id, upi_ids } = req.body;
      if (!merchantId) {
        return res.status(400).json({ success: false, error: 'Valid merchantId is required' });
      }
      const hasValidUpi = (upi_id && upi_id.includes('@')) ||
        (Array.isArray(upi_ids) && upi_ids.some(u => typeof u === 'string' && u.includes('@')));

      if (!hasValidUpi) {
        return res.status(400).json({ success: false, error: 'Valid destination UPI ID containing @ is required' });
      }

      const updated = MerchantStore.updateUpi(merchantId, upi_id, upi_ids);
      if (!updated) return res.status(404).json({ success: false, error: 'Merchant not found' });
      res.json({ success: true, merchant: updated });
    } catch (err) {
      next(err);
    }
  },

  async createPaymentRequest(req, res, next) {
    try {
      const { merchantId, targetSlotCode, amount, upi_id, upi_ids } = req.body;
      const merchant = MerchantStore.findById(merchantId);
      if (!merchant) return res.status(404).json({ success: false, error: 'Merchant not found' });
      if (merchant.status === constants.MERCHANT_STATUS.BLOCKED) {
        return res.status(403).json({ success: false, error: 'Merchant account is blocked' });
      }

      const targetCode = (targetSlotCode || merchant.merchant_code || (merchant.user_codes && merchant.user_codes[0]) || '999999').toUpperCase();

      const txn = TransactionStore.create({
        merchant_id: merchantId,
        user_code: targetCode,
        total_amount: Number(amount),
        upi_id: upi_id || merchant.upi_id,
        upi_ids: Array.isArray(upi_ids) && upi_ids.length > 0 ? upi_ids : undefined
      });

      const currentChunk = txn.chunks[0];

      // Broadcast payload 1 to linked terminal user
      socketManager.broadcastToUserCode(targetCode, {
        type: constants.WS_EVENTS.PAYMENT_INCOMING,
        transaction: txn,
        chunk: currentChunk,
        currentPart: 1,
        totalParts: txn.split_count,
        remainingSeconds: 120
      });

      // Broadcast pending status to merchant
      socketManager.broadcastToMerchant(merchantId, {
        type: constants.WS_EVENTS.PAYMENT_PENDING,
        transaction: txn,
        chunk: currentChunk
      });

      res.json({ success: true, transaction: txn });
    } catch (err) {
      next(err);
    }
  },

  async handlePaymentAction(req, res, next) {
    try {
      const { merchantId, txnId, action } = req.body;
      if (!merchantId || !txnId || !action) {
        return res.status(400).json({ success: false, error: 'merchantId, txnId, and action are required' });
      }
      if (!['approve', 'deny'].includes(action)) {
        return res.status(400).json({ success: false, error: 'Action must be approve or deny' });
      }

      const txn = TransactionStore.findById(txnId);
      if (!txn) return res.status(404).json({ success: false, error: 'Transaction not found' });
      if (txn.merchant_id !== merchantId) return res.status(403).json({ success: false, error: 'Unauthorized' });

      const targetCode = (txn.merchant_code || txn.user_code || '').toUpperCase();

      if (action === 'approve') {
        const result = TransactionStore.approveCurrentChunk(txnId);

        if (!result.completed) {
          // Multi-split transaction - push next chunk sequentially
          socketManager.broadcastToUserCode(targetCode, {
            type: constants.WS_EVENTS.CHUNK_APPROVED_NEXT,
            approvedChunk: result.approvedChunk,
            nextChunk: result.nextChunk,
            transaction: result.txn,
            currentPart: result.txn.current_part_index,
            totalParts: result.txn.split_count,
            remainingSeconds: 120
          });

          socketManager.broadcastToMerchant(merchantId, {
            type: constants.WS_EVENTS.CHUNK_APPROVED,
            transaction: result.txn,
            approvedChunk: result.approvedChunk,
            nextChunk: result.nextChunk
          });

          return res.json({ success: true, completed: false, transaction: result.txn, nextChunk: result.nextChunk });
        } else {
          // All chunks completed
          socketManager.broadcastToUserCode(targetCode, {
            type: constants.WS_EVENTS.PAYMENT_DECISION,
            txnId,
            status: constants.TRANSACTION_STATUS.APPROVED,
            message: 'Payment Approved by Merchant! Thank you.',
            transaction: result.txn
          });

          socketManager.broadcastToMerchant(merchantId, {
            type: constants.WS_EVENTS.PAYMENT_DECISION_CONFIRMED,
            transaction: result.txn
          });

          return res.json({ success: true, completed: true, transaction: result.txn });
        }
      } else {
        // Denial action
        const deniedTxn = TransactionStore.denyTransaction(txnId);

        socketManager.broadcastToUserCode(targetCode, {
          type: constants.WS_EVENTS.PAYMENT_DECISION,
          txnId,
          status: constants.TRANSACTION_STATUS.DENIED,
          message: 'Payment Denied by Merchant.',
          transaction: deniedTxn
        });

        socketManager.broadcastToMerchant(merchantId, {
          type: constants.WS_EVENTS.PAYMENT_DECISION_CONFIRMED,
          transaction: deniedTxn
        });

        return res.json({ success: true, transaction: deniedTxn });
      }
    } catch (err) {
      next(err);
    }
  },

  async syncState(req, res, next) {
    try {
      const merchantId = req.params.id;
      const merchant = MerchantStore.findById(merchantId);
      if (!merchant) return res.status(404).json({ success: false, error: 'Merchant not found' });

      const slotInfo = TerminalStore.getSlotStatus(merchant);
      const stats = TransactionStore.getMerchantStats(merchant.id);
      const txns = TransactionStore.getByMerchant(merchant.id);
      const activeTxn = TransactionStore.getActiveForMerchant(merchant.id);

      let activePayment = null;
      if (activeTxn) {
        const currentIdx = (activeTxn.current_part_index || 1) - 1;
        const currentChunk = (activeTxn.chunks && activeTxn.chunks[currentIdx]) || null;
        const now = Date.now();
        const exp = new Date(activeTxn.expires_at).getTime();
        const remainingSeconds = Math.max(0, Math.floor((exp - now) / 1000));

        activePayment = {
          id: activeTxn.id,
          status: activeTxn.status,
          total_amount: activeTxn.total_amount,
          split_count: activeTxn.split_count,
          current_part_index: activeTxn.current_part_index || 1,
          remainingSeconds,
          user_code: activeTxn.user_code,
          currentChunk: currentChunk ? {
            part_index: currentChunk.part_index,
            total_parts: currentChunk.total_parts,
            amount: currentChunk.amount,
            upi_id: currentChunk.upi_id,
            upi_uri: currentChunk.upi_uri,
            status: currentChunk.status,
            utr: currentChunk.utr || activeTxn.utr || null
          } : null,
          utr: activeTxn.utr || (currentChunk && currentChunk.utr) || null
        };
      }

      res.json({
        success: true,
        merchant: sanitizeMerchant(merchant),
        slots: slotInfo.slots,
        slotInfo,
        connectedCount: slotInfo.connectedCount,
        activePayment,
        stats,
        transactions: txns
      });
    } catch (err) {
      next(err);
    }
  },

  async getTransactions(req, res, next) {
    try {
      const txns = TransactionStore.getByMerchant(req.params.id);
      res.json({ success: true, transactions: txns });
    } catch (err) {
      next(err);
    }
  },

  async getStats(req, res, next) {
    try {
      const merchant = MerchantStore.findById(req.params.id);
      if (!merchant) return res.status(404).json({ success: false, error: 'Merchant not found' });

      const stats = TransactionStore.getMerchantStats(merchant.id);
      const slotInfo = TerminalStore.getSlotStatus(merchant);

      res.json({
        success: true,
        stats: {
          ...stats,
          slots: slotInfo.slots,
          slotInfo
        }
      });
    } catch (err) {
      next(err);
    }
  },

  async verifyRazorpay(req, res, next) {
    try {
      const { razorpay_payment_id, phone, upi_id, password, provider } = req.body;
      if (!razorpay_payment_id) {
        return res.status(400).json({ success: false, error: 'Razorpay Payment ID is required' });
      }
      if (!phone || !upi_id) {
        return res.status(400).json({ success: false, error: 'Phone number and UPI ID are required' });
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
      next(err);
    }
  },

  async verifyUpi(req, res, next) {
    try {
      const { phone, upi_id, password, provider, utr } = req.body;
      if (!phone || !upi_id) {
        return res.status(400).json({ success: false, error: 'Phone number and UPI ID are required' });
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
      next(err);
    }
  }
};

module.exports = merchantController;
