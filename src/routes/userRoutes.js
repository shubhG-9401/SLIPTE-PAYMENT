/**
 * @file userRoutes.js
 * @description Routes for customer terminal pairing, polling, and payment submission.
 */

const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

// Validation & Pairing
router.get('/validate-code/:code', userController.validateCode);

// Terminal Heartbeat & Synchronization
router.get(['/terminal/:code', '/poll/:code'], userController.pollTerminal);

// Payment Actions
router.post('/submit-payment', userController.submitPayment);
router.get('/payment-status/:txnId', userController.getPaymentStatus);

module.exports = router;
