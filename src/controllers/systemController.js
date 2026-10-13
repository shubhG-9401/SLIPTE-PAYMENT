/**
 * @file systemController.js
 * @description General system endpoints (QR generation, network IP inspection, Terminal 3 blocking).
 */

const qrService = require('../services/qrService');
const networkService = require('../services/networkService');
const constants = require('../config/constants');
const env = require('../config/env');

const systemController = {
  async generateQr(req, res, next) {
    try {
      const { text } = req.query;
      if (!text) {
        return res.status(400).json({ success: false, error: 'Text query parameter is required' });
      }
      const dataUrl = await qrService.generateDataUrl(text);
      res.json({ success: true, dataUrl });
    } catch (err) {
      next(err);
    }
  },

  getNetworkInfo(req, res) {
    const info = networkService.getLocalIpInfo(env.PORT);
    res.json({
      success: true,
      ...info
    });
  },

  blockTerminal3(req, res) {
    res.status(403).json({
      success: false,
      blocked: true,
      terminal3Blocked: true,
      slotNumber: 3,
      error: 'Access Blocked: Terminal 3 is not permitted. Only Terminal 1 and Terminal 2 are authorized.',
      message: constants.SLOT_CONFIG.BLOCK_MESSAGE
    });
  }
};

module.exports = systemController;
