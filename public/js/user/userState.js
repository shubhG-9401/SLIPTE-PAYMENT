/**
 * @file userState.js
 * @description Centralized reactive state store for Customer Terminal.
 */

(function (window) {
  'use strict';

  const initialUserState = {
    currentCode: null,
    merchantInfo: null,
    slotNumber: 1,
    uiState: 'pairing', // 'pairing' | 'waiting' | 'active' | 'submitted' | 'approved' | 'denied' | 'expired' | 'blocked'
    currentTxn: null,
    activeChunk: null,
    remainingSeconds: 120,
    qrDataUrl: null,
    terminal3Blocked: false
  };

  window.userStore = window.createStore(initialUserState);
})(window);
