/**
 * @file userApp.js
 * @description Customer Terminal application controller, QR presentation, countdown timer, and polling synchronization.
 */

(function (window, document) {
  'use strict';

  const { userStore, apiClient, soundManager, appUtils } = window;

  let ws = null;
  let timerInterval = null;
  let pollInterval = null;
  let sessionId = sessionStorage.getItem('slipte_user_sess');

  if (!sessionId) {
    sessionId = 'sess_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now().toString(36);
    sessionStorage.setItem('slipte_user_sess', sessionId);
  }

  // DOM Elements
  const codeDigits = document.getElementById('inputPairingCode') || document.getElementById('codeDigits');
  const connectTerminalBtn = document.getElementById('connectTerminalBtn');
  const pairingForm = document.getElementById('pairingForm');
  const pairingAlert = document.getElementById('pairingAlert');
  const pairingBox = document.getElementById('pairingBox');
  const upiBox = document.getElementById('upiBox');
  const terminalBlockedState = document.getElementById('terminalBlockedState');
  const blockedMerchantCode = document.getElementById('blockedMerchantCode');
  const connectionStatusBadge = document.getElementById('connectionStatusBadge');
  const merchantInfoText = document.getElementById('merchantInfoText');
  const waitingMerchantUpi = document.getElementById('waitingMerchantUpi');

  // UI States
  const waitingState = document.getElementById('waitingState');
  const paymentActiveState = document.getElementById('paymentActiveState');
  const paymentSubmittedState = document.getElementById('paymentSubmittedState');
  const paymentApprovedState = document.getElementById('paymentApprovedState');
  const paymentDeniedState = document.getElementById('paymentDeniedState');
  const paymentExpiredState = document.getElementById('paymentExpiredState');

  // Active Payment Screen Elements
  const timerText = document.getElementById('timerText');
  const timerProgressFill = document.getElementById('timerProgressFill');
  const displayTotalAmount = document.getElementById('displayTotalAmount');
  const splitNoticeBadge = document.getElementById('splitNoticeBadge');
  const qrImage = document.getElementById('qrImage');
  const qrLoading = document.getElementById('qrLoading');
  const currentPartAmount = document.getElementById('currentPartAmount');
  const currentPartRoute = document.getElementById('currentPartRoute');
  const currentPartUpi = document.getElementById('currentPartUpi');
  const upiIntentBtn = document.getElementById('upiIntentBtn');
  const copyUpiUriBtn = document.getElementById('copyUpiUriBtn');
  const inputUtr = document.getElementById('inputUtr');
  const markPaidBtn = document.getElementById('markPaidBtn');
  const receiptAmount = document.getElementById('receiptAmount');
  const resetTerminalBtn = document.getElementById('resetTerminalBtn');
  const retryTerminalBtn = document.getElementById('retryTerminalBtn');
  const expiredTerminalBtn = document.getElementById('expiredTerminalBtn') || document.getElementById('expiredRetryBtn');
  const retryPairingBtn = document.getElementById('retryPairingBtn') || document.getElementById('blockedRetryBtn');

  /* ==========================================================================
     STATE TRANSITIONS
     ========================================================================== */

  function setScreenState(stateName) {
    userStore.setState({ uiState: stateName });

    const states = [
      waitingState, paymentActiveState, paymentSubmittedState,
      paymentApprovedState, paymentDeniedState, paymentExpiredState
    ];
    states.forEach(el => el && el.classList.add('hidden'));

    if (stateName === 'waiting' && waitingState) waitingState.classList.remove('hidden');
    else if (stateName === 'active' && paymentActiveState) paymentActiveState.classList.remove('hidden');
    else if (stateName === 'submitted' && paymentSubmittedState) paymentSubmittedState.classList.remove('hidden');
    else if (stateName === 'approved' && paymentApprovedState) paymentApprovedState.classList.remove('hidden');
    else if (stateName === 'denied' && paymentDeniedState) paymentDeniedState.classList.remove('hidden');
    else if (stateName === 'expired' && paymentExpiredState) paymentExpiredState.classList.remove('hidden');
  }

  function showTerminal3Blocked(code, message) {
    if (pollInterval) clearInterval(pollInterval);
    if (ws) { try { ws.close(); } catch (e) {} }

    soundManager.play('alert');
    if (pairingBox) pairingBox.classList.add('hidden');
    if (upiBox) upiBox.classList.add('hidden');
    if (terminalBlockedState) {
      terminalBlockedState.classList.remove('hidden');
      if (blockedMerchantCode) blockedMerchantCode.textContent = code || '------';
    }
    if (connectionStatusBadge) {
      connectionStatusBadge.textContent = '⚠️ Terminal 3 Blocked';
      connectionStatusBadge.className = 'status-badge blocked';
    }
  }

  /* ==========================================================================
     PAIRING & TERMINAL CONNECTION
     ========================================================================== */

  async function connectTerminal(code) {
    if (!code) return;
    const cleanCode = code.trim().toUpperCase();

    if (pairingAlert) pairingAlert.classList.add('hidden');

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

      onTerminalConnected({
        code: cleanCode,
        merchantPhone: data.merchant ? data.merchant.phone : '',
        merchantUpi: data.merchant ? data.merchant.upi_id : 'merchant@paytm',
        slot: data.slot
      });

      // If active payment already pending, display it immediately
      if (data.activePayment) {
        const ap = data.activePayment;
        const txn = ap.transaction || ap;
        renderActivePayment(txn, ap.remainingSeconds || 120, ap.qrDataUrl);
      }

      startHttpPolling(cleanCode);
      initWebSocket(cleanCode);
    } catch (err) {
      if (err.terminal3Blocked || (err.data && err.data.terminal3Blocked)) {
        showTerminal3Blocked(cleanCode, err.message);
        return;
      }
      if (pairingAlert) {
        pairingAlert.textContent = '❌ ' + (err.message || 'Connection failed');
        pairingAlert.className = 'alert error';
        pairingAlert.classList.remove('hidden');
      }
    }
  }

  function onTerminalConnected(msg) {
    const slotText = msg.slot ? ` (Slot ${msg.slot})` : '';
    if (connectionStatusBadge) {
      connectionStatusBadge.textContent = `Terminal Live${slotText}`;
      connectionStatusBadge.className = 'status-badge online';
    }

    if (pairingBox) pairingBox.classList.add('hidden');
    if (terminalBlockedState) terminalBlockedState.classList.add('hidden');
    if (upiBox) upiBox.classList.remove('hidden');

    if (merchantInfoText) merchantInfoText.textContent = `Merchant Connected (${msg.code || '999999'})${slotText}`;
    if (waitingMerchantUpi && msg.merchantUpi) waitingMerchantUpi.textContent = msg.merchantUpi;

    // Default to waiting state unless active payment already present
    if (!userStore.getState().currentTxn) {
      setScreenState('waiting');
    }
  }

  /* ==========================================================================
     ACTIVE PAYMENT & DYNAMIC QR DISPLAY
     ========================================================================== */

  function renderActivePayment(txn, secs = 120, preloadedQrDataUrl = null) {
    userStore.setState({ currentTxn: txn, remainingSeconds: secs });

    if (displayTotalAmount) displayTotalAmount.textContent = Number(txn.total_amount).toFixed(2);
    if (receiptAmount) receiptAmount.textContent = appUtils.formatCurrency(txn.total_amount);

    const currentIdx = (txn.current_part_index || 1) - 1;
    const currentChunk = (txn.chunks && txn.chunks[currentIdx]) || {
      amount: txn.total_amount,
      upi_id: txn.merchant_upi_id || 'paytm.s1m66cw@pty',
      upi_uri: appUtils.buildUpiUri(txn.merchant_upi_id, txn.total_amount)
    };

    if (splitNoticeBadge) {
      if (txn.split_count > 1) {
        splitNoticeBadge.classList.remove('hidden');
        splitNoticeBadge.textContent = `Payload ${txn.current_part_index || 1} of ${txn.split_count} (Auto-Split ≤ ₹1999)`;
      } else {
        splitNoticeBadge.classList.add('hidden');
      }
    }

    if (currentPartAmount) currentPartAmount.textContent = `Pay ${appUtils.formatCurrency(currentChunk.amount)}`;
    const destinationUpi = currentChunk.upi_id || txn.merchant_upi_id || 'paytm.s1m66cw@pty';
    if (currentPartUpi) currentPartUpi.textContent = destinationUpi;

    const uri = currentChunk.upi_uri || appUtils.buildUpiUri(destinationUpi, currentChunk.amount);
    if (upiIntentBtn) upiIntentBtn.href = uri;

    // Reset UTR input for new chunk
    if (inputUtr) inputUtr.value = '';

    // QR Image Rendering
    if (preloadedQrDataUrl) {
      if (qrImage) qrImage.src = preloadedQrDataUrl;
      if (qrLoading) qrLoading.classList.add('hidden');
    } else {
      if (qrLoading) qrLoading.classList.remove('hidden');
      apiClient.get('/api/qr', { text: uri }).then(d => {
        if (d.dataUrl && qrImage) {
          qrImage.src = d.dataUrl;
          if (qrLoading) qrLoading.classList.add('hidden');
        }
      }).catch(() => {
        if (qrLoading) qrLoading.textContent = 'Generating QR code...';
      });
    }

    startTimer(secs);
    setScreenState('active');
  }

  function startTimer(duration = 120) {
    clearInterval(timerInterval);
    let timeLeft = duration;

    function tick() {
      const mins = Math.floor(timeLeft / 60);
      const secs = timeLeft % 60;
      if (timerText) timerText.textContent = `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;

      const pct = Math.max(0, (timeLeft / 120) * 100);
      if (timerProgressFill) {
        timerProgressFill.style.width = pct + '%';
        if (timeLeft <= 30) {
          timerProgressFill.classList.add('urgent');
          if (timerText) timerText.classList.add('urgent');
        } else {
          timerProgressFill.classList.remove('urgent');
          if (timerText) timerText.classList.remove('urgent');
        }
      }

      if (timeLeft <= 0) {
        clearInterval(timerInterval);
        setScreenState('expired');
      }
      timeLeft--;
    }

    tick();
    timerInterval = setInterval(tick, 1000);
  }

  /* ==========================================================================
     HTTP POLLING BACKUP (LOCAL & SERVERLESS HEARTBEAT)
     ========================================================================== */

  let lastProcessedTxnKey = null;

  function startHttpPolling(code) {
    if (pollInterval) clearInterval(pollInterval);

    async function poll() {
      try {
        const data = await apiClient.get(`/api/user/terminal/${encodeURIComponent(code)}`, { sessionId });

        if (data.terminal3Blocked || (data.blocked && data.slotNumber === 3)) {
          showTerminal3Blocked(code, data.message);
          return;
        }

        if (data.slot && connectionStatusBadge) {
          connectionStatusBadge.textContent = `Terminal Live (Slot ${data.slot})`;
          connectionStatusBadge.className = 'status-badge online';
        }

        if (data.activePayment) {
          const ap = data.activePayment;
          const txn = ap.transaction || ap;
          const stateKey = `${ap.id}_part_${ap.currentPart}_${ap.status}`;

          if (lastProcessedTxnKey !== stateKey) {
            lastProcessedTxnKey = stateKey;

            if (ap.status === 'submitted') {
              setScreenState('submitted');
            } else if (ap.status === 'pending') {
              if (ap.currentPart > 1) {
                soundManager.play('chime');
              } else {
                soundManager.play('alert');
              }
              renderActivePayment(txn, ap.remainingSeconds || 120, ap.qrDataUrl);
            }
          }
        } else if (data.lastTransaction) {
          const lt = data.lastTransaction;
          const state = userStore.getState();
          // ONLY trigger decision if terminal is actively processing this transaction
          if (state.currentTxn && state.currentTxn.id === lt.id && (state.uiState === 'active' || state.uiState === 'submitted')) {
            const stateKey = `${lt.id}_decision_${lt.status}`;
            if (lastProcessedTxnKey !== stateKey) {
              lastProcessedTxnKey = stateKey;
              if (lt.status === 'approved') {
                soundManager.play('chime');
                setScreenState('approved');
              } else if (lt.status === 'denied') {
                soundManager.play('alert');
                setScreenState('denied');
              }
            }
          } else if (state.uiState !== 'waiting' && !state.currentTxn) {
            setScreenState('waiting');
          }
        } else {
          const currentState = userStore.getState().uiState;
          if (currentState !== 'waiting') {
            userStore.setState({ currentTxn: null });
            setScreenState('waiting');
            lastProcessedTxnKey = null;
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

  function initWebSocket(code) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'user_init', userCode: code }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === 'user_ready') {
            onTerminalConnected(msg);
          } else if (msg.type === 'user_error') {
            if (msg.terminal3Blocked) {
              showTerminal3Blocked(code, msg.message);
            }
          } else if (msg.type === 'payment_incoming' || msg.type === 'active_payment') {
            soundManager.play('alert');
            renderActivePayment(msg.transaction, msg.remainingSeconds || 120);
          } else if (msg.type === 'chunk_approved_next') {
            soundManager.play('chime');
            renderActivePayment(msg.transaction, msg.remainingSeconds || 120);
          } else if (msg.type === 'payment_decision') {
            if (msg.status === 'approved') {
              soundManager.play('chime');
              setScreenState('approved');
            } else {
              soundManager.play('alert');
              setScreenState('denied');
            }
          } else if (msg.type === 'merchant_blocked') {
            alert('⚠️ ' + msg.message);
            location.reload();
          }
        } catch (e) {}
      };

      ws.onclose = () => {
        setTimeout(() => {
          const c = userStore.getState().currentCode;
          if (c) initWebSocket(c);
        }, 5000);
      };
    } catch (err) {}
  }

  /* ==========================================================================
     DOM EVENT HANDLERS
     ========================================================================== */

  function initDomEvents() {
    // Form submit listener (handles both Enter key and submit button)
    if (pairingForm) {
      pairingForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const code = codeDigits ? codeDigits.value.trim() : '';
        if (!code) {
          if (pairingAlert) {
            pairingAlert.textContent = 'Please enter a 6-digit Assigned Unique Code.';
            pairingAlert.className = 'alert error';
            pairingAlert.classList.remove('hidden');
          }
          return;
        }
        connectTerminal(code);
      });
    }

    if (connectTerminalBtn && !pairingForm) {
      connectTerminalBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const code = codeDigits ? codeDigits.value.trim() : '';
        if (code) connectTerminal(code);
      });
    }

    if (codeDigits) {
      codeDigits.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const code = codeDigits.value.trim();
          if (code) connectTerminal(code);
        }
      });
    }

    // Copy UPI link button
    if (copyUpiUriBtn) {
      copyUpiUriBtn.addEventListener('click', () => {
        const txn = userStore.getState().currentTxn;
        if (!txn) return;
        const currentIdx = (txn.current_part_index || 1) - 1;
        const chunk = (txn.chunks && txn.chunks[currentIdx]) || {};
        const uri = chunk.upi_uri || (upiIntentBtn && upiIntentBtn.href);
        if (uri) {
          appUtils.copyToClipboard(uri, copyUpiUriBtn);
        }
      });
    }

    // Submit payment verification (Have Paid)
    if (markPaidBtn) {
      markPaidBtn.addEventListener('click', async () => {
        const txn = userStore.getState().currentTxn;
        if (!txn) return;
        const utrVal = inputUtr ? inputUtr.value.trim() : '';
        const utr = utrVal || 'Submitted (Self-Reported)';
        try {
          await apiClient.post('/api/user/submit-payment', { txnId: txn.id, utr });
          setScreenState('submitted');
        } catch (err) {
          alert('Submission error: ' + err.message);
        }
      });
    }

    // State reset handlers
    const resetButtons = [resetTerminalBtn, retryTerminalBtn, expiredTerminalBtn];
    resetButtons.forEach(btn => {
      if (btn) {
        btn.addEventListener('click', () => {
          userStore.setState({ currentTxn: null });
          setScreenState('waiting');
        });
      }
    });

    if (retryPairingBtn) {
      retryPairingBtn.addEventListener('click', () => {
        if (terminalBlockedState) terminalBlockedState.classList.add('hidden');
        if (pairingBox) pairingBox.classList.remove('hidden');
        if (connectionStatusBadge) {
          connectionStatusBadge.textContent = 'Offline';
          connectionStatusBadge.className = 'status-badge offline';
        }
        if (codeDigits) {
          codeDigits.value = '';
          codeDigits.focus();
        }
      });
    }

    // Check URL parameters for direct pairing link: e.g. /user.html?code=999999
    const params = new URLSearchParams(window.location.search);
    const urlCode = params.get('code') || params.get('inputPairingCode');
    if (urlCode) {
      const cleanUrlCode = urlCode.trim();
      if (codeDigits) codeDigits.value = cleanUrlCode;
      setTimeout(() => connectTerminal(cleanUrlCode), 150);
    }
  }

  document.addEventListener('DOMContentLoaded', initDomEvents);

})(window, document);
