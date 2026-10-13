/**
 * @file adminState.js
 * @description Centralized reactive state store for Platform Administration Dashboard.
 */

(function (window) {
  'use strict';

  const initialAdminState = {
    isAuthenticated: false,
    stats: {
      totalGMV: 0,
      totalMerchants: 0,
      activeMerchants: 0,
      totalTransactions: 0,
      approvedTransactions: 0,
      activeTerminalsCount: 0
    },
    merchants: [],
    transactions: []
  };

  window.adminStore = window.createStore(initialAdminState);
})(window);
