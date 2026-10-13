/**
 * @file adminRoutes.js
 * @description Routes for administrative monitoring, governance, and directory audits.
 */

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

router.post('/login', adminController.login);
router.get('/stats', adminController.getStats);
router.get('/merchants', adminController.getMerchants);
router.post('/merchant-status', adminController.updateMerchantStatus);
router.post('/reset-password', adminController.resetPassword);
router.post('/clear-data', adminController.clearData);
router.get('/transactions', adminController.getTransactions);

module.exports = router;
