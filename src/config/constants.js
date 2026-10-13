/**
 * @file constants.js
 * @description Centralized application constants and business rules.
 */

module.exports = {
  // Transaction statuses
  TRANSACTION_STATUS: {
    PENDING: 'pending',
    SUBMITTED: 'submitted',
    APPROVED: 'approved',
    DENIED: 'denied',
    EXPIRED: 'expired'
  },

  // Chunk statuses
  CHUNK_STATUS: {
    QUEUED: 'queued',
    PENDING: 'pending',
    SUBMITTED: 'submitted',
    APPROVED: 'approved',
    DENIED: 'denied'
  },

  // Merchant account statuses
  MERCHANT_STATUS: {
    ACTIVE: 'active',
    BLOCKED: 'blocked'
  },

  // WebSocket message types
  WS_EVENTS: {
    MERCHANT_INIT: 'merchant_init',
    MERCHANT_READY: 'merchant_ready',
    USER_INIT: 'user_init',
    USER_READY: 'user_ready',
    USER_ERROR: 'user_error',
    SLOT_UPDATED: 'slot_updated',
    PAYMENT_INCOMING: 'payment_incoming',
    PAYMENT_PENDING: 'payment_pending',
    ACTIVE_PAYMENT: 'active_payment',
    PAYMENT_SUBMITTED: 'payment_submitted',
    CHUNK_APPROVED_NEXT: 'chunk_approved_next',
    CHUNK_APPROVED: 'chunk_approved',
    PAYMENT_DECISION: 'payment_decision',
    PAYMENT_DECISION_CONFIRMED: 'payment_decision_confirmed',
    PAYMENT_EXPIRED: 'payment_expired',
    MERCHANT_BLOCKED: 'merchant_blocked'
  },

  // Slot configuration
  SLOT_CONFIG: {
    MAX_ALLOWED: 2,
    TERMINAL_3_NAME: 'User Terminal 3',
    BLOCK_MESSAGE: '⚠️ ACCESS BLOCKED: Terminal 3 is restricted. Maximum 2 terminals are permitted per merchant.'
  },

  // Defaults
  DEFAULTS: {
    PAYTM_UPI: 'paytm.s1m66cw@pty',
    DEMO_MERCHANT_CODE: '999999',
    DEMO_PHONE: '9999999999'
  }
};
