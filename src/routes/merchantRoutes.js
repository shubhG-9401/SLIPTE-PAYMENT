/**
 * @file merchantRoutes.js
 * @description Routes for merchant registration, login, profile, and payment operations.
 */

const express = require('express');
const router = express.Router();
const merchantController = require('../controllers/merchantController');
const validator = require('../middlewares/validator');

// Authentication & Profile
router.post('/register', validator.validateRegistration, merchantController.register);
router.post('/login', validator.validateLogin, merchantController.login);
router.get('/me/:id', merchantController.getProfile);
router.get('/demo', merchantController.getDemo);
router.post('/regenerate-codes', merchantController.regenerateCodes);
router.post('/update-upi', merchantController.updateUpi);

// Payment Operations
router.post(['/payment-request', '/dispatch'], validator.validatePaymentRequest, merchantController.createPaymentRequest);
router.post('/payment-action', merchantController.handlePaymentAction);

// Synchronization & History
router.get('/sync/:id', merchantController.syncState);
router.get('/transactions/:id', merchantController.getTransactions);
router.get('/stats/:id', merchantController.getStats);

// Verification Webhooks / Callbacks
router.post('/verify-razorpay', merchantController.verifyRazorpay);
router.post('/verify-upi', merchantController.verifyUpi);

module.exports = router;
