/**
 * @file systemRoutes.js
 * @description Routes for system utilities (QR code generator, network info, Terminal 3 blocking guard).
 */

const express = require('express');
const router = express.Router();
const systemController = require('../controllers/systemController');

router.get('/qr', systemController.generateQr);
router.get('/network-info', systemController.getNetworkInfo);
router.get('/config', systemController.getConfig);
router.all(['/terminal/3', '/merchant/terminal/3'], systemController.blockTerminal3);

module.exports = router;
