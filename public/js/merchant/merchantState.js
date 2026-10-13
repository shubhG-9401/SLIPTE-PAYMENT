/**
 * @file merchantState.js
 * @description Centralized reactive state store for Merchant Dashboard.
 */

(function (window) {
  'use strict';

  const initialMerchantState = {
    currentMerchant: null,
    activeTxn: null,
    slotInfo: {
      connectedCount: 0,
      maxSlots: 2,
      slotText: '0/2',
      slots: [],
      terminal3Blocked: true
    },
    stats: {
      totalRevenue: 0,
      todayRevenue: 0,
      approvedCount: 0,
      deniedCount: 0
    },
    transactions: [],
    timerSeconds: 120,
    configuredUpiList: ['paytm.s1m66cw@pty']
  };

  window.merchantStore = window.createStore(initialMerchantState);
})(window);
