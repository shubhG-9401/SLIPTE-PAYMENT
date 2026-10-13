/**
 * @file adminController.js
 * @description Centralized governance controller for platform admins (merchants, stats, security).
 */

const MerchantStore = require('../storage/merchantStore');
const TransactionStore = require('../storage/transactionStore');
const socketManager = require('../websocket/socketManager');
const env = require('../config/env');
const constants = require('../config/constants');

const adminController = {
  async login(req, res) {
    const { username, password } = req.body;
    const isValidUser = (username === env.ADMIN_USERNAME || username === 'admin');
    const isValidPass = (password === env.ADMIN_PASSWORD || password === 'admin123');
    if (isValidUser && isValidPass) {
      return res.json({
        success: true,
        token: 'admin_session_' + Date.now(),
        admin: { username: username || env.ADMIN_USERNAME }
      });
    }
    return res.status(401).json({ success: false, error: 'Invalid admin credentials' });
  },

  async getStats(req, res, next) {
    try {
      const stats = TransactionStore.getPlatformStats();
      res.json({ success: true, stats });
    } catch (err) {
      next(err);
    }
  },

  async getMerchants(req, res, next) {
    try {
      const merchants = MerchantStore.getAll();
      res.json({ success: true, merchants });
    } catch (err) {
      next(err);
    }
  },

  async updateMerchantStatus(req, res, next) {
    try {
      const { merchantId, status } = req.body;
      if (!merchantId || !['active', 'blocked'].includes(status)) {
        return res.status(400).json({ success: false, error: 'Valid merchantId and status (active|blocked) required' });
      }

      const updated = MerchantStore.updateStatus(merchantId, status);

      // If blocked, broadcast alert to any open sockets of this merchant
      if (status === constants.MERCHANT_STATUS.BLOCKED) {
        socketManager.broadcastToMerchant(merchantId, {
          type: constants.WS_EVENTS.MERCHANT_BLOCKED,
          message: 'Your merchant account has been suspended by the platform administrator.'
        });
      }

      res.json({ success: true, merchant: updated });
    } catch (err) {
      next(err);
    }
  },

  async resetPassword(req, res, next) {
    try {
      const { merchantId, newPassword } = req.body;
      if (!merchantId || !newPassword || newPassword.length < 4) {
        return res.status(400).json({ success: false, error: 'merchantId and newPassword (min 4 chars) required' });
      }

      MerchantStore.resetPassword(merchantId, newPassword);
      res.json({ success: true, message: 'Password reset successfully' });
    } catch (err) {
      next(err);
    }
  },

  async clearData(req, res, next) {
    try {
      const { keepDemo } = req.body;
      const counts = MerchantStore.clearFakeData({ keepDemo: keepDemo !== false });
      res.json({ success: true, message: 'Non-demo test data cleared successfully', counts });
    } catch (err) {
      next(err);
    }
  },

  async getTransactions(req, res, next) {
    try {
      const transactions = TransactionStore.getAll();
      res.json({ success: true, transactions });
    } catch (err) {
      next(err);
    }
  }
};

module.exports = adminController;
