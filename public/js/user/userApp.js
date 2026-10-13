/**
 * @file userApp.js
 * @description Customer UPI Terminal application controller featuring dynamic single-view mounting,
 * circular SVG countdown timer, live WebSocket badge, 12-digit UTR validation, and split payment step dots.
 */

(function (window, document) {
  'use strict';

  const { userStore, apiClient, soundManager, appUtils, uiComponents } = window;

  let wsManager = null;
  let timerRing = null;
  let pollInterval = null;
  let lastProcessedTxnKey = null;

  // Persistent session identifier for slot allocation
  let sessionId = sessionStorage.getItem('slipte_user_sess');
  if (!sessionId) {
    sessionId = 'sess_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now().toString(36);
    sessionStorage.setItem('slipte_user_sess', sessionId);
  }

  // Root Containers & Header Elements
  const userTerminalApp = document.getElementById('userTerminalApp');
  const userConnBadge = document.getElementById('userConnBadge');

  // View Templates
  const templates = {
    pairing: document.getElementById('tmplPairing'),
    blocked: document.getElementById('tmplBlocked'),
    waiting: document.getElementById('tmplWaiting'),
    active: document.getElementById('tmplActivePayment'),
    submitted: document.getElementById('tmplSubmitted'),
    approved: document.getElementById('tmplApproved'),
    denied: document.getElementById('tmplDenied'),
    expired: document.getElementById('tmplExpired')
  };

  /* ==========================================================================
     VIEW MOUNTING (SHOW ONLY ONE STATE PER SCREEN)
     ========================================================================== */

  let currentView = null;

  function renderScreen(viewName, data = {}) {
    if (!userTerminalApp) return;

    if (timerRing) {
      timerRing.stop();
      timerRing = null;
    }

    currentView = viewName;
    userStore.setState({ uiState: viewName });
    userTerminalApp.innerHTML = '';

    const tmpl = templates[viewName];
    if (!tmpl) {
      console.error(`View template tmpl${viewName} not found.`);
      return;
    }

    const clone = tmpl.content.cloneNode(true);
    userTerminalApp.appendChild(clone);

    // Bind view-specific controls
    if (viewName === 'pairing') bindPairingView(data);
    else if (viewName === 'blocked') bindBlockedView(data);
    else if (viewName === 'waiting') bindWaitingView(data);
    else if (viewName === 'active') bindActiveView(data);
    else if (viewName === 'submitted') bindSubmittedView(data);
    else if (viewName === 'approved') bindApprovedView(data);
    else if (viewName === 'denied') bindDeniedView(data);
    else if (viewName === 'expired') bindExpiredView(data);
  }

  /* ==========================================================================
     VIEW BINDINGS
     ========================================================================== */

  // 1. Pairing View
  function bindPairingView(data = {}) {
    const form = document.getElementById('pairingForm');
    const input = document.getElementById('inputPairingCode');
    const alertBox = document.getElementById('pairingAlert');

    if (input) {
      input.value = data.prefillCode || '';
      input.focus();
    }

    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const code = input ? input.value.trim() : '';
        if (!code) {
          if (alertBox) {
            alertBox.textContent = '⚠️ Please enter a 6-digit Assigned Unique Code.';
            alertBox.className = 'alert error';
            alertBox.classList.remove('hidden');
          }
          if (input) input.focus();
          return;
        }
        connectTerminal(code);
      });
    }
  }

  // 2. Blocked View (Terminal 3 Limit Reached)
  function bindBlockedView(data = {}) {
    const codeEl = document.getElementById('blockedMerchantCode');
    const retryBtn = document.getElementById('retryPairingBtn');

    if (codeEl) codeEl.textContent = data.code || '------';

    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        renderScreen('pairing', { prefillCode: '' });
      });
    }
  }

  // 3. Waiting View
  function bindWaitingView(data = {}) {
    const state = userStore.getState();
    const infoText = document.getElementById('merchantInfoText');
    const upiText = document.getElementById('waitingMerchantUpi');

    const code = state.currentCode || data.code || '999999';
    const slot = state.slotNumber || data.slot || 1;
    const upi = (state.merchantInfo && state.merchantInfo.upi_id) || data.merchantUpi || 'merchant@paytm';

    if (infoText) infoText.textContent = `Merchant Connected (${code}) (Slot ${slot})`;
    if (upiText) upiText.textContent = upi;
  }

  // 4. Active Payment View
  function bindActiveView(data = {}) {
    const txn = data.transaction || userStore.getState().currentTxn;
    if (!txn) {
      renderScreen('waiting');
      return;
    }

    const secs = typeof data.remainingSeconds === 'number' ? data.remainingSeconds : 120;
    const preloadedQr = data.qrDataUrl || null;

    const activeMerchantTag = document.getElementById('activeMerchantTag');
    const totalAmountEl = document.getElementById('displayTotalAmount');
    const splitNoticeBadge = document.getElementById('splitNoticeBadge');
    const splitStepsBox = document.getElementById('splitStepsBox');
    const splitStepBadge = document.getElementById('splitStepBadge');
    const splitProgressDots = document.getElementById('splitProgressDots');

    const qrFrame = document.getElementById('userQrFrame');
    const qrImg = document.getElementById('qrImage');
    const qrLoading = document.getElementById('qrLoading');
    const qrExpiredOverlay = document.getElementById('qrExpiredOverlay');

    const currentPartAmount = document.getElementById('currentPartAmount');
    const currentPartUpi = document.getElementById('currentPartUpi');
    const upiIntentBtn = document.getElementById('upiIntentBtn');
    const copyUpiUriBtn = document.getElementById('copyUpiUriBtn');

    const inputUtr = document.getElementById('inputUtr');
    const utrErrorMsg = document.getElementById('utrErrorMsg');
    const markPaidBtn = document.getElementById('markPaidBtn');

    const timerRingCircle = document.getElementById('userTimerRingCircle');
    const timerDigits = document.getElementById('userTimerDigits');

    // Display Merchant Tag
    const state = userStore.getState();
    if (activeMerchantTag && state.currentCode) {
      activeMerchantTag.textContent = `Merchant ${state.currentCode} Live`;
    }

    // Billboard Total Amount
    if (totalAmountEl) totalAmountEl.textContent = Number(txn.total_amount).toFixed(2);

    // Current Chunk Details
    const currentIdx = Math.max(0, (txn.current_part_index || 1) - 1);
    const chunk = (txn.chunks && txn.chunks[currentIdx]) || {
      amount: txn.total_amount,
      upi_id: txn.merchant_upi_id || 'paytm.s1m66cw@pty',
      upi_uri: appUtils.buildUpiUri(txn.merchant_upi_id, txn.total_amount)
    };

    // Sequential Split Steps Indicator (e.g. Part 2 of 3)
    const splitCount = txn.split_count || 1;
    const currentPartNum = txn.current_part_index || 1;

    if (splitCount > 1) {
      if (splitNoticeBadge) {
        splitNoticeBadge.classList.remove('hidden');
        splitNoticeBadge.textContent = `Auto-Split (≤ ₹1999)`;
      }
      if (splitStepsBox) splitStepsBox.classList.remove('hidden');
      if (splitStepBadge) splitStepBadge.textContent = `Part ${currentPartNum} of ${splitCount}`;

      if (splitProgressDots) {
        splitProgressDots.innerHTML = '';
        for (let i = 1; i <= splitCount; i++) {
          const dot = document.createElement('span');
          dot.className = 'split-dot';
          if (i < currentPartNum) dot.classList.add('completed');
          else if (i === currentPartNum) dot.classList.add('current');
          dot.setAttribute('title', `Step ${i} of ${splitCount}`);
          splitProgressDots.appendChild(dot);
        }
      }
    } else {
      if (splitNoticeBadge) splitNoticeBadge.classList.add('hidden');
      if (splitStepsBox) splitStepsBox.classList.add('hidden');
    }

    // Part Amount & Route
    if (currentPartAmount) currentPartAmount.textContent = `Pay ${appUtils.formatCurrency(chunk.amount)}`;
    const destinationUpi = chunk.upi_id || txn.merchant_upi_id || 'paytm.s1m66cw@pty';
    if (currentPartUpi) currentPartUpi.textContent = destinationUpi;

    // UPI Deep Link & Copy
    const uri = chunk.upi_uri || appUtils.buildUpiUri(destinationUpi, chunk.amount);
    if (upiIntentBtn) upiIntentBtn.href = uri;

    if (copyUpiUriBtn) {
      copyUpiUriBtn.addEventListener('click', () => {
        appUtils.copyToClipboard(uri, copyUpiUriBtn);
        uiComponents.showToast('UPI payment link copied!', 'info');
      });
    }

    // QR Image Presentation with Alt Text
    if (qrImg) {
      qrImg.alt = `Scan QR Code to pay ₹${Number(chunk.amount).toFixed(2)} to ${destinationUpi}`;
    }

    if (preloadedQr) {
      if (qrImg) qrImg.src = preloadedQr;
      if (qrLoading) qrLoading.classList.add('hidden');
    } else {
      if (qrLoading) qrLoading.classList.remove('hidden');
      apiClient.get('/api/qr', { text: uri }).then(d => {
        if (d.dataUrl && qrImg) {
          qrImg.src = d.dataUrl;
          if (qrLoading) qrLoading.classList.add('hidden');
        }
      }).catch(() => {
        if (qrLoading) qrLoading.textContent = 'Generating Dynamic QR...';
      });
    }

    // Circular SVG Countdown Timer Ring
    timerRing = uiComponents.createTimerRing({
      ringCircleEl: timerRingCircle,
      timerDigitsEl: timerDigits,
      duration: secs,
      onExpire: () => {
        // Dim and disable QR code
        if (qrFrame) qrFrame.classList.add('expired');
        if (qrExpiredOverlay) qrExpiredOverlay.classList.remove('hidden');
        if (markPaidBtn) markPaidBtn.disabled = true;
        if (upiIntentBtn) upiIntentBtn.classList.add('disabled');
        uiComponents.showToast('Payment window expired (120s elapsed)', 'error');
        soundManager.play('alert');
      }
    });
    timerRing.start();

    // 12-Digit UTR Validation
    function validateUtr(showError = true) {
      if (!inputUtr) return true;
      const raw = inputUtr.value.trim();
      const isValid = /^\d{12}$/.test(raw);

      if (!isValid && showError) {
        if (utrErrorMsg) {
          if (raw.length === 0) {
            utrErrorMsg.textContent = '⚠️ Please enter the 12-digit UTR from your UPI payment app.';
          } else {
            utrErrorMsg.textContent = `⚠️ UTR must be exactly 12 numeric digits (currently ${raw.length} digits).`;
          }
          utrErrorMsg.classList.remove('hidden');
        }
        inputUtr.style.borderColor = '#ef4444';
      } else {
        if (utrErrorMsg) utrErrorMsg.classList.add('hidden');
        inputUtr.style.borderColor = '';
      }
      return isValid;
    }

    if (inputUtr) {
      // Auto-filter non-digit characters
      inputUtr.addEventListener('input', () => {
        inputUtr.value = inputUtr.value.replace(/\D/g, '').slice(0, 12);
        if (inputUtr.value.length === 12) {
          validateUtr(false);
        }
      });
      inputUtr.addEventListener('blur', () => {
        if (inputUtr.value.length > 0) {
          validateUtr(true);
        }
      });
    }

    // Mark Paid / Submit UTR
    if (markPaidBtn) {
      markPaidBtn.addEventListener('click', async () => {
        if (!validateUtr(true)) {
          if (inputUtr) inputUtr.focus();
          return;
        }

        const utr = inputUtr.value.trim();
        try {
          markPaidBtn.disabled = true;
          markPaidBtn.textContent = 'Submitting...';
          await apiClient.post('/api/user/submit-payment', { txnId: txn.id, utr });
          uiComponents.showToast('Payment submitted for merchant approval', 'info');
          renderScreen('submitted');
        } catch (err) {
          markPaidBtn.disabled = false;
          markPaidBtn.textContent = '✓ I Have Paid (Notify Merchant)';
          uiComponents.showToast('Submission error: ' + err.message, 'error');
        }
      });
    }
  }

  // 5. Submitted View
  function bindSubmittedView() {
    // Waiting for merchant decision
  }

  // 6. Approved View
  function bindApprovedView(data = {}) {
    const receiptEl = document.getElementById('receiptAmount');
    const resetBtn = document.getElementById('resetTerminalBtn');
    const state = userStore.getState();

    const amt = data.amount || (state.currentTxn ? state.currentTxn.total_amount : 0);
    if (receiptEl) receiptEl.textContent = appUtils.formatCurrency(amt);

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        userStore.setState({ currentTxn: null });
        renderScreen('waiting');
      });
    }
  }

  // 7. Denied View
  function bindDeniedView() {
    const retryBtn = document.getElementById('retryTerminalBtn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        userStore.setState({ currentTxn: null });
        renderScreen('waiting');
      });
    }
  }

  // 8. Expired View
  function bindExpiredView() {
    const expiredBtn = document.getElementById('expiredTerminalBtn');
    if (expiredBtn) {
      expiredBtn.addEventListener('click', () => {
        userStore.setState({ currentTxn: null });
        renderScreen('waiting');
      });
    }
  }

  /* ==========================================================================
     PAIRING & BACKEND SYNCHRONIZATION
     ========================================================================== */

  async function connectTerminal(code) {
    if (!code) return;
    const cleanCode = code.trim().toUpperCase();

    const alertBox = document.getElementById('pairingAlert');
    if (alertBox) alertBox.classList.add('hidden');

    try {
      const data = await apiClient.get(`/api/user/terminal/${encodeURIComponent(cleanCode)}`, { sessionId });

      if (data.terminal3Blocked || data.slotNumber === 3) {
        showTerminal3Blocked(cleanCode, data.message || data.error);
        return;
      }

      userStore.setState({
        currentCode: cleanCode,
        merchantInfo: data.merchant,
        slotNumber: data.slot || 1
      });

      try { localStorage.setItem('slipte_last_code', cleanCode); } catch (e) {}

      // Tell WebSocket server we paired with this merchant code
      if (wsManager) {
        wsManager.send({ type: 'user_init', userCode: cleanCode });
      }

      if (data.activePayment) {
        const ap = data.activePayment;
        const txn = ap.transaction || ap;
        userStore.setState({ currentTxn: txn, remainingSeconds: ap.remainingSeconds || 120 });
        renderScreen('active', {
          transaction: txn,
          remainingSeconds: ap.remainingSeconds || 120,
          qrDataUrl: ap.qrDataUrl
        });
      } else {
        renderScreen('waiting', {
          code: cleanCode,
          slot: data.slot,
          merchantUpi: data.merchant ? data.merchant.upi_id : 'merchant@paytm'
        });
      }

      startHttpPolling(cleanCode);
    } catch (err) {
      if (err.terminal3Blocked || (err.data && err.data.terminal3Blocked)) {
        showTerminal3Blocked(cleanCode, err.message);
        return;
      }
      if (alertBox) {
        alertBox.textContent = '❌ ' + (err.message || 'Connection failed');
        alertBox.className = 'alert error';
        alertBox.classList.remove('hidden');
      }
    }
  }

  function showTerminal3Blocked(code, message) {
    if (pollInterval) clearInterval(pollInterval);
    soundManager.play('alert');
    renderScreen('blocked', { code, message });
  }

  /* ==========================================================================
     HTTP POLLING BACKUP (LOCAL HEARTBEAT)
     ========================================================================== */

  function startHttpPolling(code) {
    if (pollInterval) clearInterval(pollInterval);

    async function poll() {
      try {
        const data = await apiClient.get(`/api/user/terminal/${encodeURIComponent(code)}`, { sessionId });

        if (data.terminal3Blocked || (data.blocked && data.slotNumber === 3)) {
          showTerminal3Blocked(code, data.message);
          return;
        }

        if (data.activePayment) {
          const ap = data.activePayment;
          const txn = ap.transaction || ap;
          const stateKey = `${ap.id}_part_${ap.currentPart}_${ap.status}`;

          if (lastProcessedTxnKey !== stateKey) {
            lastProcessedTxnKey = stateKey;

            if (ap.status === 'submitted') {
              if (currentView !== 'submitted') renderScreen('submitted');
            } else if (ap.status === 'pending') {
              if (ap.currentPart > 1) {
                soundManager.play('chime');
              } else {
                soundManager.play('alert');
              }
              userStore.setState({ currentTxn: txn, remainingSeconds: ap.remainingSeconds || 120 });
              renderScreen('active', {
                transaction: txn,
                remainingSeconds: ap.remainingSeconds || 120,
                qrDataUrl: ap.qrDataUrl
              });
            }
          }
        } else if (data.lastTransaction) {
          const lt = data.lastTransaction;
          const state = userStore.getState();
          if (state.currentTxn && state.currentTxn.id === lt.id && (currentView === 'active' || currentView === 'submitted')) {
            const stateKey = `${lt.id}_decision_${lt.status}`;
            if (lastProcessedTxnKey !== stateKey) {
              lastProcessedTxnKey = stateKey;
              if (lt.status === 'approved') {
                soundManager.play('chime');
                uiComponents.showToast('Payment Verified & Approved!', 'success');
                renderScreen('approved', { amount: lt.total_amount });
              } else if (lt.status === 'denied') {
                soundManager.play('alert');
                uiComponents.showToast('Payment Denied by merchant', 'error');
                renderScreen('denied');
              }
            }
          } else if (currentView !== 'waiting' && !state.currentTxn) {
            renderScreen('waiting');
          }
        } else {
          if (currentView !== 'waiting' && currentView !== 'pairing' && currentView !== 'blocked') {
            userStore.setState({ currentTxn: null });
            lastProcessedTxnKey = null;
            renderScreen('waiting');
          }
        }
      } catch (err) {
        if (err.terminal3Blocked) {
          showTerminal3Blocked(code, err.message);
        }
      }
    }

    poll();
    pollInterval = setInterval(poll, 1500);
  }

  /* ==========================================================================
     WEBSOCKET REAL-TIME SYNC
     ========================================================================== */

  function initWebSocket() {
    wsManager = uiComponents.setupWebSocketWithBadge({
      path: '',
      badgeEl: userConnBadge,
      onOpen: (ws) => {
        const code = userStore.getState().currentCode;
        if (code) {
          ws.send(JSON.stringify({ type: 'user_init', userCode: code }));
        }
      },
      onMessage: (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === 'user_ready') {
            const state = userStore.getState();
            userStore.setState({
              currentCode: msg.code,
              slotNumber: msg.slot || 1,
              merchantInfo: { upi_id: msg.merchantUpi, phone: msg.merchantPhone }
            });
            if (currentView === 'pairing') {
              renderScreen('waiting', {
                code: msg.code,
                slot: msg.slot,
                merchantUpi: msg.merchantUpi
              });
            }
          } else if (msg.type === 'user_error') {
            if (msg.terminal3Blocked) {
              showTerminal3Blocked(userStore.getState().currentCode, msg.message);
            }
          } else if (msg.type === 'payment_incoming' || msg.type === 'active_payment') {
            soundManager.play('alert');
            userStore.setState({ currentTxn: msg.transaction, remainingSeconds: msg.remainingSeconds || 120 });
            renderScreen('active', {
              transaction: msg.transaction,
              remainingSeconds: msg.remainingSeconds || 120
            });
          } else if (msg.type === 'chunk_approved_next') {
            soundManager.play('chime');
            uiComponents.showToast('Part approved! Proceeding to next part...', 'success');
            userStore.setState({ currentTxn: msg.transaction, remainingSeconds: msg.remainingSeconds || 120 });
            renderScreen('active', {
              transaction: msg.transaction,
              remainingSeconds: msg.remainingSeconds || 120
            });
          } else if (msg.type === 'payment_decision') {
            if (msg.status === 'approved') {
              soundManager.play('chime');
              uiComponents.showToast('Payment Verified & Approved!', 'success');
              renderScreen('approved', { amount: msg.transaction ? msg.transaction.total_amount : 0 });
            } else {
              soundManager.play('alert');
              uiComponents.showToast('Payment Denied by merchant', 'error');
              renderScreen('denied');
            }
          } else if (msg.type === 'merchant_blocked') {
            uiComponents.showToast('Merchant terminal has been blocked', 'error');
            setTimeout(() => location.reload(), 1500);
          }
        } catch (e) {
          console.error('Error processing WS message:', e);
        }
      }
    });
  }

  /* ==========================================================================
     INITIALIZATION
     ========================================================================== */

  function init() {
    // Start with pairing screen
    renderScreen('pairing');

    // Connect WebSocket
    initWebSocket();

    // Check URL parameters for direct link: e.g. /user.html?code=999999
    const params = new URLSearchParams(window.location.search);
    const urlCode = params.get('code') || params.get('inputPairingCode');
    if (urlCode) {
      const cleanUrlCode = urlCode.trim();
      setTimeout(() => connectTerminal(cleanUrlCode), 150);
    }
  }

  document.addEventListener('DOMContentLoaded', init);

})(window, document);
