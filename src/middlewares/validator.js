/**
 * @file validator.js
 * @description Input validation middlewares for API routes.
 */

const { normalizePhone } = require('../utils/helpers');

const validator = {
  validateRegistration(req, res, next) {
    const { phone, password, upi_id } = req.body;
    const cleanPhone = normalizePhone(phone);
    if (!cleanPhone || cleanPhone.length !== 10) {
      return res.status(400).json({ success: false, error: 'A valid 10-digit mobile number is required' });
    }
    if (!password || String(password).length < 4) {
      return res.status(400).json({ success: false, error: 'Password must be at least 4 characters long' });
    }
    if (upi_id && !String(upi_id).includes('@')) {
      return res.status(400).json({ success: false, error: 'UPI ID must contain @ (e.g. yourname@paytm)' });
    }
    next();
  },

  validateLogin(req, res, next) {
    const { phone, password } = req.body;
    const cleanPhone = normalizePhone(phone);
    if (!cleanPhone || cleanPhone.length !== 10) {
      return res.status(400).json({ success: false, error: 'A valid 10-digit mobile number is required' });
    }
    if (!password) {
      return res.status(400).json({ success: false, error: 'Password is required' });
    }
    next();
  },

  validatePaymentRequest(req, res, next) {
    const { merchantId, amount, targetTerminal, targetSlotCode } = req.body;

    // Terminal 3 blocking guard
    if (
      targetTerminal === 3 ||
      targetTerminal === '3' ||
      (targetSlotCode && (
        targetSlotCode.endsWith('-3') ||
        targetSlotCode.includes('slot3') ||
        targetSlotCode.includes('terminal3')
      ))
    ) {
      return res.status(403).json({
        success: false,
        terminal3Blocked: true,
        error: '⚠️ Access Blocked: Terminal 3 is not allowed. Only Terminal 1 and Terminal 2 are authorized.'
      });
    }

    if (!merchantId) {
      return res.status(400).json({ success: false, error: 'Valid merchantId is required' });
    }
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Valid positive payment amount is required' });
    }

    next();
  }
};

module.exports = validator;
