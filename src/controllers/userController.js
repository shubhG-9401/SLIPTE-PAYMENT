/**
 * @file userController.js
 * @description Handles customer terminal pairing, heartbeats, QR polling, and UTR submissions.
 */

const MerchantStore = require('../storage/merchantStore');
const TransactionStore = require('../storage/transactionStore');
const TerminalStore = require('../storage/terminalStore');
const qrService = require('../services/qrService');
const socketManager = require('../websocket/socketManager');
const constants = require('../config/constants');
const { maskPhone } = require('../utils/helpers');

const userController = {
  async validateCode(req, res, next) {
    try {
      const code = req.params.code;
      const merchant = MerchantStore.findByUserCode(code) || MerchantStore.findByMerchantCode(code);

      if (!merchant) {
        return res.status(404).json({ valid: false, error: 'Invalid pairing code' });
      }
      if (merchant.status === constants.MERCHANT_STATUS.BLOCKED) {
        return res.status(403).json({ valid: false, error: 'Merchant account is blocked' });
      }

      res.json({
        valid: true,
        merchant: {
          id: merchant.id,
          phone: maskPhone(merchant.phone),
          upi_id: merchant.upi_id,
          provider: merchant.provider
        }
      });
    } catch (err) {
      next(err);
    }
  },

  async pollTerminal(req, res, next) {
    try {
      const rawCode = req.params.code;
      const cleanCode = (rawCode || '').trim().toUpperCase();
      const sessionId = req.query.sessionId || req.headers['x-forwarded-for'] || req.socket.remoteAddress || ('sess_' + cleanCode);

      const merchant = MerchantStore.findByUserCode(cleanCode) || MerchantStore.findByMerchantCode(cleanCode);
      if (!merchant) {
        return res.status(404).json({ valid: false, error: 'Merchant not found' });
      }

      if (merchant.status === constants.MERCHANT_STATUS.BLOCKED) {
        return res.json({ valid: false, blocked: true, message: 'Merchant account has been blocked by administrator.' });
      }

      // Register heartbeat in TerminalStore
      const terminal = TerminalStore.registerHeartbeat(cleanCode, sessionId);
      if (terminal && terminal.blocked) {
        return res.status(403).json({
          valid: false,
          blocked: true,
          terminal3Blocked: true,
          slotNumber: 3,
          error: terminal.error || 'Access Blocked: Terminal 3 is not permitted.',
          message: terminal.message || constants.SLOT_CONFIG.BLOCK_MESSAGE
        });
      }

      const slotInfo = TerminalStore.getSlotStatus(merchant);

      // Lookup active transaction
      const activeTxn = TransactionStore.getActiveForUserCode(cleanCode);
      let activePayment = null;

      if (activeTxn) {
        const currentIdx = (activeTxn.current_part_index || 1) - 1;
        const currentChunk = (activeTxn.chunks && activeTxn.chunks[currentIdx]) ||
          (activeTxn.splits && activeTxn.splits[currentIdx]) || null;
        const now = Date.now();
        const exp = new Date(activeTxn.expires_at).getTime();
        const remainingSeconds = Math.max(0, Math.floor((exp - now) / 1000));

        const targetUpiUri = (currentChunk && currentChunk.upi_uri)
          ? currentChunk.upi_uri
          : `upi://pay?pa=${(activeTxn.merchant_upi_id || 'merchant@paytm').trim()}&am=${Number(activeTxn.total_amount).toFixed(2).replace(/\.00$/, '')}&cu=INR&tn=Verified Merchant Account`;

        let qrDataUrl = null;
        try {
          qrDataUrl = await qrService.generateDataUrl(targetUpiUri);
        } catch (e) {
          // Fallback if QR generation fails
        }

        activePayment = {
          type: constants.WS_EVENTS.ACTIVE_PAYMENT,
          id: activeTxn.id,
          transaction: activeTxn,
          chunk: currentChunk,
          chunkUpi: (currentChunk && currentChunk.upi_id) || activeTxn.merchant_upi_id,
          status: activeTxn.status,
          total_amount: activeTxn.total_amount,
          split_count: activeTxn.split_count,
          currentPart: activeTxn.current_part_index || 1,
          totalParts: activeTxn.split_count || 1,
          chunkAmount: currentChunk ? currentChunk.amount : activeTxn.total_amount,
          upiUri: targetUpiUri,
          qrDataUrl,
          remainingSeconds,
          utr: activeTxn.utr || null
        };
      }

      // Check latest completed transaction
      const latestTxn = TransactionStore.getLatestForCode(cleanCode);
      let lastTransaction = null;
      if (latestTxn) {
        lastTransaction = {
          id: latestTxn.id,
          status: latestTxn.status,
          total_amount: latestTxn.total_amount,
          approved_amount: latestTxn.approved_amount,
          current_part_index: latestTxn.current_part_index,
          split_count: latestTxn.split_count,
          updated_at: latestTxn.approved_at || latestTxn.denied_at || latestTxn.created_at
        };
      }

      res.json({
        valid: true,
        success: true,
        code: cleanCode,
        slot: terminal ? terminal.slotNumber : 1,
        slotNumber: terminal ? terminal.slotNumber : 1,
        connectedCount: slotInfo.connectedCount,
        slotInfo,
        merchant: {
          id: merchant.id,
          phone: maskPhone(merchant.phone),
          upi_id: merchant.upi_id,
          provider: merchant.provider
        },
        activePayment,
        lastTransaction
      });
    } catch (err) {
      next(err);
    }
  },

  async submitPayment(req, res, next) {
    try {
      const { txnId, utr, chunkPart } = req.body;
      if (!txnId) {
        return res.status(400).json({ success: false, error: 'txnId is required' });
      }

      const txn = TransactionStore.submitUtr(txnId, utr);
      const targetChunk = (txn.chunks && txn.chunks[(txn.current_part_index || 1) - 1]) || null;

      // Broadcast submitted payment event to merchant
      socketManager.broadcastToMerchant(txn.merchant_id, {
        type: 'user_payment_submitted',
        txnId,
        utr: txn.utr,
        currentPart: txn.current_part_index || 1,
        totalParts: txn.split_count || 1,
        amount: targetChunk ? targetChunk.amount : txn.total_amount,
        chunk: targetChunk
      });

      res.json({
        success: true,
        message: 'Payment details submitted to merchant for verification',
        transaction: txn
      });
    } catch (err) {
      next(err);
    }
  },

  async getPaymentStatus(req, res, next) {
    try {
      const txn = TransactionStore.findById(req.params.txnId);
      if (!txn) {
        return res.status(404).json({ success: false, error: 'Transaction not found' });
      }
      res.json({
        success: true,
        status: txn.status,
        approved_amount: txn.approved_amount,
        current_part_index: txn.current_part_index,
        split_count: txn.split_count,
        transaction: txn
      });
    } catch (err) {
      next(err);
    }
  }
};

module.exports = userController;
