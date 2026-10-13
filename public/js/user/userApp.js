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
  const codeDigits = document.getElementById('codeDigits');
  const connectTerminalBtn = document.getElementById('connectTerminalBtn');
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
  const markPaidBtn = document.getElementById('markPaidBtn');
  const receiptAmount = document.getElementById('receiptAmount');
  const resetTerminalBtn = document.getElementById('resetTerminalBtn');
  const retryTerminalBtn = document.getElementById('retryTerminalBtn');
  const expiredRetryBtn = document.getElementById('expiredRetryBtn');
  const blockedRetryBtn = document.getElementById('blockedRetryBtn');

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
    if (pairingAlert) pairingAlert.classList.add('hidden');

    try {
      const data = await apiClient.get(`/api/user/terminal/${encodeURIComponent(code)}`, { sessionId });

      if (data.terminal3Blocked || data.slotNumber === 3) {
        showTerminal3Blocked(code, data.message || data.error);
        return;
      }

      userStore.setState({
        currentCode: code,
        merchantInfo: data.merchant,
        slotNumber: data.slot || 1
      });

      try { localStorage.setItem('slipte_last_code', code); } catch (e) {}

      onTerminalConnected({
        code,
        merchantPhone: data.merchant.phone,
        merchantUpi: data.merchant.upi_id,
        slot: data.slot
      });

      startHttpPolling(code);
      initWebSocket(code);
    } catch (err) {
      if (err.terminal3Blocked || (err.data && err.data.terminal3Blocked)) {
        showTerminal3Blocked(code, err.message);
        return;
      }
      if (pairingAlert) {
        pairingAlert.textContent = err.message;
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
    if (upiBox) upiBox.classList.remove('hidden');

    if (merchantInfoText) merchantInfoText.textContent = `Merchant Connected (${msg.code || '999999'})${slotText}`;
    if (waitingMerchantUpi && msg.merchantUpi) waitingMerchantUpi.textContent = msg.merchantUpi;

    setScreenState('waiting');
  }

  /* ==========================================================================
     ACTIVE PAYMENT & DYNAMIC QR DISPLAY
     ========================================================================== */

  function renderActivePayment(txn, secs = 120, preloadedQrDataUrl = null) {
    userStore.setState({ currentTxn: txn, remainingSeconds: secs });

    displayTotalAmount.textContent = Number(txn.total_amount).toFixed(2);
    if (receiptAmount) receiptAmount.textContent = appUtils.formatCurrency(txn.total_amount);

    const currentIdx = (txn.current_part_index || 1) - 1;
    const currentChunk = (txn.chunks && txn.chunks[currentIdx]) || {
      amount: txn.total_amount,
      upi_id: txn.merchant_upi_id || 'paytm.s1m66cw@pty',
      upi_uri: appUtils.buildUpiUri(txn.merchant_upi_id, txn.total_amount)
    };

    if (txn.split_count > 1) {
      splitNoticeBadge.classList.remove('hidden');
      splitNoticeBadge.textContent = `Payload ${txn.current_part_index || 1} of ${txn.split_count} (Auto-Split ≤ ₹1999)`;
    } else {
      splitNoticeBadge.classList.add('hidden');
    }

    currentPartAmount.textContent = `Pay ${appUtils.formatCurrency(currentChunk.amount)}`;
    const destinationUpi = currentChunk.upi_id || txn.merchant_upi_id || 'paytm.s1m66cw@pty';
    if (currentPartUpi) currentPartUpi.textContent = destinationUpi;

    if (upiIntentBtn) upiIntentBtn.href = currentChunk.upi_uri;

    // QR Image Rendering
    if (preloadedQrDataUrl) {
      qrImage.src = preloadedQrDataUrl;
      qrLoading.classList.add('hidden');
    } else {
      qrLoading.classList.remove('hidden');
      apiClient.get('/api/qr', { text: currentChunk.upi_uri }).then(d => {
        if (d.dataUrl) {
          qrImage.src = d.dataUrl;
          qrLoading.classList.add('hidden');
        }
      }).catch(() => {
        qrLoading.textContent = 'Failed to generate QR';
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
        } else {
          const currentState = userStore.getState().uiState;
          if (currentState !== 'waiting' && currentState !== 'pairing') {
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
          const code = userStore.getState().currentCode;
          if (code) initWebSocket(code);
        }, 5000);
      };
    } catch (err) {}
  }

  /* ==========================================================================
     DOM EVENT HANDLERS
     ========================================================================== */

  function initDomEvents() {
    if (connectTerminalBtn) {
      connectTerminalBtn.addEventListener('click', () => {
        const code = (codeDigits.value || '').trim();
        if (!code) {
          pairingAlert.textContent = 'Please enter a 6-digit Assigned Unique Code.';
          pairingAlert.className = 'alert error';
          pairingAlert.classList.remove('hidden');
          return;
        }
        connectTerminal(code);
      });
    }

    if (codeDigits) {
      codeDigits.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          connectTerminal(codeDigits.value.trim());
        }
      });
    }

    if (markPaidBtn) {
      markPaidBtn.addEventListener('click', async () => {
        const txn = userStore.getState().currentTxn;
        if (!txn) return;
        const utr = prompt('Enter Bank Reference / UTR Number (Optional):', '') || 'Submitted (Self-Reported)';
        try {
          await apiClient.post('/api/user/submit-payment', { txnId: txn.id, utr });
          setScreenState('submitted');
        } catch (err) {
          alert('Submission error: ' + err.message);
        }
      });
    }

    if (resetTerminalBtn) resetTerminalBtn.addEventListener('click', () => setScreenState('waiting'));
    if (retryTerminalBtn) retryTerminalBtn.addEventListener('click', () => setScreenState('waiting'));
    if (expiredRetryBtn) expiredRetryBtn.addEventListener('click', () => setScreenState('waiting'));
    if (blockedRetryBtn) blockedRetryBtn.addEventListener('click', () => location.reload());

    // Check URL parameters for direct pairing link: e.g. /user.html?code=999999
    const params = new URLSearchParams(window.location.search);
    const urlCode = params.get('code');
    if (urlCode && codeDigits) {
      codeDigits.value = urlCode;
      setTimeout(() => connectTerminal(urlCode), 300);
    }
  }

  document.addEventListener('DOMContentLoaded', initDomEvents);

})(window, document);
