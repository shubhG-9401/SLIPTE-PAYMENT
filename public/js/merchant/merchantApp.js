/**
 * @file merchantApp.js
 * @description Merchant Portal application controller, DOM renderer, and event dispatcher.
 */

(function (window, document) {
  'use strict';

  const { merchantStore, apiClient, soundManager, appUtils } = window;
  let ws = null;
  let timerInterval = null;
  let pollInterval = null;

  // DOM Elements
  const authSection = document.getElementById('authSection');
  const dashboardSection = document.getElementById('dashboardSection');
  const navUserSection = document.getElementById('navUserSection');
  const navMerchantPhone = document.getElementById('navMerchantPhone');
  const logoutBtn = document.getElementById('logoutBtn');

  // Login & Registration
  const loginForm = document.getElementById('loginForm');
  const loginAlert = document.getElementById('loginAlert');
  const registerForm = document.getElementById('registerForm');
  const regAlert = document.getElementById('regAlert');
  const tabLogin = document.getElementById('tabLogin');
  const tabRegister = document.getElementById('tabRegister');
  const tryDemoBtn = document.getElementById('tryDemoBtn');
  const tryDemoNavBtn = document.getElementById('tryDemoNavBtn');
  const fillDemoCredsBtn = document.getElementById('fillDemoCredsBtn');

  // Terminal & UPI Controls
  const upiCountSelect = document.getElementById('upiCountSelect');
  const saveUpiBtn = document.getElementById('saveUpiBtn');
  const dynamicUpiContainer = document.getElementById('dynamicUpiInputs');
  const amountInput = document.getElementById('paymentAmount');
  const paymentRequestForm = document.getElementById('paymentRequestForm');
  const splitTitle = document.getElementById('splitPreviewTitle');
  const splitPills = document.getElementById('splitPillsContainer');
  const pushPaymentBtn = document.getElementById('pushPaymentBtn');

  // Active Transaction Display
  const noActiveTxnMsg = document.getElementById('noActiveTxnMsg');
  const activeTxnDetails = document.getElementById('activeTxnDetails');
  const activeChunkTag = document.getElementById('activeChunkTag');
  const activeTotalTag = document.getElementById('activeTotalTag');
  const activeAmountVal = document.getElementById('activeAmountVal');
  const activeSplitSubtext = document.getElementById('activeSplitSubtext');
  const activeStatusBanner = document.getElementById('activeStatusBanner');
  const activeStatusText = document.getElementById('activeStatusText');
  const activeTimerBadge = document.getElementById('activeTimerBadge');
  const activeUtrBox = document.getElementById('activeUtrBox');
  const activeUtrVal = document.getElementById('activeUtrVal');
  const approvePaymentBtn = document.getElementById('approvePaymentBtn');
  const denyPaymentBtn = document.getElementById('denyPaymentBtn');
  const controllerHint = document.getElementById('controllerHint');

  // Stats & History
  const statTotalRevenue = document.getElementById('statTotalRevenue');
  const statTodayRevenue = document.getElementById('statTodayRevenue');
  const statApprovedCount = document.getElementById('statApprovedCount');
  const statDeniedCount = document.getElementById('statDeniedCount');
  const refreshStatsBtn = document.getElementById('refreshStatsBtn');
  const txnTableBody = document.getElementById('txnTableBody');
  const noTxnsRow = document.getElementById('noTxnsRow');

  // Modal & Warning Controls
  const terminal3WarningBanner = document.getElementById('terminal3WarningBanner');
  const closeWarningBtn = document.getElementById('closeWarningBtn');
  const testTerminal3Btn = document.getElementById('testTerminal3Btn');
  const phoneQrModalBtn = document.getElementById('phoneQrModalBtn');
  const phoneConnectModal = document.getElementById('phoneConnectModal');
  const closePhoneModalBtn = document.getElementById('closePhoneModalBtn');
  const phoneTerminalQrImg = document.getElementById('phoneTerminalQrImg');
  const phoneTerminalUrlText = document.getElementById('phoneTerminalUrlText');
  const copyPhoneUrlBtn = document.getElementById('copyPhoneUrlBtn');
  const copyMerchantCodeBtn = document.getElementById('copyMerchantCodeBtn');

  /* ==========================================================================
     AUTHENTICATION & SESSION
     ========================================================================== */

  function initAuthTabs() {
    if (tabLogin && tabRegister) {
      tabLogin.addEventListener('click', () => {
        tabLogin.classList.add('active');
        tabRegister.classList.remove('active');
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
      });

      tabRegister.addEventListener('click', () => {
        tabRegister.classList.add('active');
        tabLogin.classList.remove('active');
        registerForm.classList.remove('hidden');
        loginForm.classList.add('hidden');
      });
    }

    if (fillDemoCredsBtn) {
      fillDemoCredsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const phone = document.getElementById('loginPhone');
        const pass = document.getElementById('loginPassword');
        if (phone) phone.value = '9999999999';
        if (pass) pass.value = 'demo123';
        if (loginAlert) {
          loginAlert.textContent = '✓ Demo credentials filled. Click "Sign In to Dashboard" below.';
          loginAlert.className = 'alert success';
          loginAlert.classList.remove('hidden');
        }
      });
    }

    if (tryDemoBtn) tryDemoBtn.addEventListener('click', handleLaunchDemo);
    if (tryDemoNavBtn) tryDemoNavBtn.addEventListener('click', handleLaunchDemo);

    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        loginAlert.classList.add('hidden');

        const phone = document.getElementById('loginPhone').value.trim();
        const password = document.getElementById('loginPassword').value;

        try {
          const res = await apiClient.post('/api/merchant/login', { phone, password });
          handleLoginSuccess(res.merchant);
        } catch (err) {
          loginAlert.textContent = '❌ ' + err.message;
          loginAlert.className = 'alert error';
          loginAlert.classList.remove('hidden');
        }
      });
    }

    const regSubmitBtn = document.getElementById('regSubmitBtn');
    if (regSubmitBtn) {
      regSubmitBtn.addEventListener('click', async () => {
        regAlert.classList.add('hidden');
        const phone = document.getElementById('regPhone').value.trim();
        const upi_id = document.getElementById('regUpi').value.trim();
        const password = document.getElementById('regPassword').value;

        try {
          const res = await apiClient.post('/api/merchant/register', {
            phone,
            password,
            upi_id: upi_id || 'paytm.s1m66cw@pty',
            provider: 'paytm'
          });
          regAlert.textContent = `🎉 Account registered! Assigned code: ${res.merchant.merchant_code}`;
          regAlert.className = 'alert success';
          regAlert.classList.remove('hidden');
          setTimeout(() => handleLoginSuccess(res.merchant), 600);
        } catch (err) {
          regAlert.textContent = '❌ ' + err.message;
          regAlert.className = 'alert error';
          regAlert.classList.remove('hidden');
        }
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('slipte_merchant_session');
        if (ws) ws.close();
        clearInterval(timerInterval);
        clearInterval(pollInterval);
        merchantStore.setState({ currentMerchant: null, activeTxn: null });
        navUserSection.classList.add('hidden');
        dashboardSection.classList.add('hidden');
        authSection.classList.remove('hidden');
      });
    }
  }

  async function handleLaunchDemo() {
    try {
      const res = await apiClient.get('/api/merchant/demo');
      handleLoginSuccess(res.merchant);
    } catch (err) {
      alert('Error launching demo sandbox: ' + err.message);
    }
  }

  function handleLoginSuccess(merchant) {
    merchantStore.setState({
      currentMerchant: merchant,
      configuredUpiList: merchant.upi_ids || [merchant.upi_id || 'paytm.s1m66cw@pty']
    });

    localStorage.setItem('slipte_merchant_session', JSON.stringify(merchant));

    authSection.classList.add('hidden');
    dashboardSection.classList.remove('hidden');
    navUserSection.classList.remove('hidden');

    const isDemo = merchant.is_demo || merchant.merchant_code === '999999' || merchant.merchant_code === 'MC-99';
    navMerchantPhone.textContent = merchant.phone + (isDemo ? ' [Demo]' : '');
    document.getElementById('dashMerchantPhone').textContent = merchant.phone;
    document.getElementById('dashMerchantUpi').textContent = merchant.upi_id || 'paytm.s1m66cw@pty';

    const code = merchant.merchant_code || (merchant.user_codes && merchant.user_codes[0]) || '999999';
    const codeEl = document.getElementById('dashMerchantCode');
    if (codeEl) codeEl.textContent = code;

    const openTerminalLink = document.getElementById('openTerminalLink');
    if (openTerminalLink) {
      openTerminalLink.href = `/user.html?code=${code}`;
    }

    initUpiInputControls(merchant.upi_ids || [merchant.upi_id || 'paytm.s1m66cw@pty']);
    renderSlots(merchant.slots || [], merchant.slotInfo);

    startSyncPolling();
    initWebSocket();
  }

  /* ==========================================================================
     MULTI-UPI CONFIGURATION & AUTO-SPLIT PREVIEW
     ========================================================================== */

  function initUpiInputControls(initialUpis) {
    if (!upiCountSelect || !dynamicUpiContainer) return;

    const upis = Array.isArray(initialUpis) && initialUpis.length > 0
      ? initialUpis.filter(u => u && u.includes('@'))
      : ['paytm.s1m66cw@pty'];

    const count = Math.min(5, Math.max(1, upis.length));
    upiCountSelect.value = String(count);

    renderDynamicUpiInputs(count, upis);
  }

  function renderDynamicUpiInputs(count, existingValues = []) {
    if (!dynamicUpiContainer) return;

    if (!existingValues || existingValues.length === 0) {
      existingValues = Array.from(dynamicUpiContainer.querySelectorAll('.upi-row-input')).map(inp => inp.value.trim());
    }

    const state = merchantStore.getState();
    const defaultUpi = (state.currentMerchant && state.currentMerchant.upi_id) || 'paytm.s1m66cw@pty';
    dynamicUpiContainer.innerHTML = '';

    for (let i = 0; i < count; i++) {
      const row = document.createElement('div');
      row.className = 'upi-input-row';

      const badge = document.createElement('span');
      badge.className = 'upi-row-badge';
      badge.textContent = `UPI #${i + 1}${i === 0 ? ' (Primary)' : ''}`;

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'upi-row-input';
      input.id = `destUpi_${i + 1}`;
      input.placeholder = i === 0 ? defaultUpi : `e.g. store${i + 1}@paytm`;
      input.value = existingValues[i] || (i === 0 ? defaultUpi : '');
      input.required = (i === 0);

      input.addEventListener('input', updateSplitPreview);

      row.appendChild(badge);
      row.appendChild(input);
      dynamicUpiContainer.appendChild(row);
    }

    updateSplitPreview();
  }

  function getActiveUpiList() {
    if (!dynamicUpiContainer) return ['paytm.s1m66cw@pty'];
    const inputs = Array.from(dynamicUpiContainer.querySelectorAll('.upi-row-input'));
    const values = inputs.map(i => i.value.trim()).filter(v => v && v.includes('@'));
    if (values.length > 0) return values;
    const m = merchantStore.getState().currentMerchant;
    return [(m && m.upi_id) || 'paytm.s1m66cw@pty'];
  }

  function updateSplitPreview() {
    if (!amountInput || !splitTitle || !splitPills) return;

    const val = parseFloat(amountInput.value);
    const upiList = getActiveUpiList();

    if (!val || val <= 0) {
      splitTitle.textContent = 'Auto-Splitting Preview';
      splitPills.innerHTML = '<span class="split-pill single">Enter an amount to see single or auto-split breakdown</span>';
      if (pushPaymentBtn) pushPaymentBtn.textContent = 'Push Payment Request →';
      return;
    }

    const parts = appUtils.calculateSplits(val, 1999);

    if (parts.length === 1) {
      const targetUpi = upiList[0];
      const uri = appUtils.buildUpiUri(targetUpi, parts[0]);
      splitTitle.textContent = `Condition A (Amount ≤ ₹1999): Single Payload`;
      splitPills.innerHTML = `
        <div class="split-preview-item">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span class="split-pill single">Payload 1: ${appUtils.formatCurrency(parts[0])}</span>
            <span class="chunk-upi-target">➔ Dest UPI: ${targetUpi}</span>
          </div>
          <code class="upi-uri-string">${uri}</code>
        </div>
      `;
      if (pushPaymentBtn) pushPaymentBtn.textContent = `Push Payload 1 (${appUtils.formatCurrency(parts[0])}) to User →`;
    } else {
      splitTitle.textContent = `Condition B (Amount > ₹1999): Auto-Split into ${parts.length} Payloads (${upiList.length > 1 ? `Routed across ${upiList.length} Merchant UPIs` : 'Max ₹1999 each'})`;
      splitPills.innerHTML = parts.map((amt, i) => {
        const chunkUpi = upiList[i % upiList.length];
        const uri = appUtils.buildUpiUri(chunkUpi, amt);
        return `
          <div class="split-preview-item">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
              <span class="split-pill chunk">Payload ${i + 1}: ${appUtils.formatCurrency(amt)}</span>
              <span class="chunk-upi-target">➔ Dest UPI #${(i % upiList.length) + 1}: ${chunkUpi}</span>
            </div>
            <code class="upi-uri-string">${uri}</code>
            <span class="chunk-note">${i === 0 ? 'Pushed First (120s timer)' : 'Queued sequentially after approval'}</span>
          </div>
        `;
      }).join('');
      if (pushPaymentBtn) pushPaymentBtn.textContent = `Push Payload 1 (${appUtils.formatCurrency(parts[0])}) of ${parts.length} →`;
    }
  }

  function initPaymentRequestEvents() {
    if (upiCountSelect) {
      upiCountSelect.addEventListener('change', () => {
        const count = parseInt(upiCountSelect.value, 10) || 1;
        renderDynamicUpiInputs(count);
      });
    }

    if (amountInput) {
      amountInput.addEventListener('input', updateSplitPreview);
    }

    if (saveUpiBtn) {
      saveUpiBtn.addEventListener('click', async () => {
        const upiList = getActiveUpiList();
        const m = merchantStore.getState().currentMerchant;
        if (!m) return;

        try {
          const res = await apiClient.post('/api/merchant/update-upi', {
            merchantId: m.id,
            upi_id: upiList[0],
            upi_ids: upiList
          });

          merchantStore.setState({
            currentMerchant: res.merchant,
            configuredUpiList: upiList
          });

          document.getElementById('dashMerchantUpi').textContent = upiList[0];
          saveUpiBtn.textContent = `✓ Saved (${upiList.length})!`;
          setTimeout(() => { saveUpiBtn.textContent = '💾 Save UPI IDs'; }, 2000);
          updateSplitPreview();
        } catch (err) {
          alert('Failed to save UPI IDs: ' + err.message);
        }
      });
    }

    if (paymentRequestForm) {
      paymentRequestForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const amount = parseFloat(amountInput.value);
        if (!amount || amount <= 0) return alert('Please enter a valid amount');

        const upiList = getActiveUpiList();
        const m = merchantStore.getState().currentMerchant;
        if (!m) return;

        try {
          const res = await apiClient.post('/api/merchant/payment-request', {
            merchantId: m.id,
            targetSlotCode: m.merchant_code,
            amount,
            upi_id: upiList[0],
            upi_ids: upiList
          });

          setActiveTransaction(res.transaction, 120);
          soundManager.play('beep');
        } catch (err) {
          alert('Error creating payment: ' + err.message);
        }
      });
    }

    if (approvePaymentBtn) {
      approvePaymentBtn.addEventListener('click', () => handlePaymentDecision('approve'));
    }
    if (denyPaymentBtn) {
      denyPaymentBtn.addEventListener('click', () => handlePaymentDecision('deny'));
    }
    if (refreshStatsBtn) {
      refreshStatsBtn.addEventListener('click', syncMerchantState);
    }
  }

  /* ==========================================================================
     ACTIVE TRANSACTION CONTROLLER
     ========================================================================== */

  function setActiveTransaction(txn, remainingSeconds = 120) {
    merchantStore.setState({ activeTxn: txn });
    clearInterval(timerInterval);

    if (!txn) {
      noActiveTxnMsg.classList.remove('hidden');
      activeTxnDetails.classList.add('hidden');
      activeTimerBadge.classList.add('hidden');
      return;
    }

    noActiveTxnMsg.classList.add('hidden');
    activeTxnDetails.classList.remove('hidden');

    const currentIdx = (txn.current_part_index || 1) - 1;
    const currentChunk = (txn.chunks && txn.chunks[currentIdx]) || { amount: txn.total_amount };
    const chunkUpi = currentChunk.upi_id || txn.merchant_upi_id || 'paytm.s1m66cw@pty';

    activeChunkTag.textContent = `Payload ${txn.current_part_index || 1} of ${txn.split_count || 1}`;
    activeTotalTag.textContent = `Total: ${appUtils.formatCurrency(txn.total_amount)}`;
    activeAmountVal.textContent = appUtils.formatCurrency(currentChunk.amount);
    activeSplitSubtext.textContent = txn.split_count > 1
      ? `Sequential Chunk ${txn.current_part_index || 1} of ${txn.split_count} • Receiving on ${chunkUpi}`
      : `Single Payment Payload • Receiving on ${chunkUpi}`;

    activeStatusBanner.className = 'active-status-banner';
    activeStatusBanner.style.background = '';
    activeStatusBanner.style.color = '';
    activeStatusText.textContent = 'Waiting for customer to scan QR on terminal...';
    activeUtrBox.classList.add('hidden');

    if (controllerHint) {
      if (txn.split_count > 1 && (txn.current_part_index || 1) < txn.split_count) {
        controllerHint.textContent = `⚡ Approving will update sales stats (+${appUtils.formatCurrency(currentChunk.amount)}) and push Payload ${(txn.current_part_index || 1) + 1} to user.`;
      } else {
        controllerHint.textContent = 'Verify incoming funds in your Paytm app before approving.';
      }
    }

    // 120-Second Countdown Timer
    activeTimerBadge.classList.remove('hidden');
    let timeLeft = remainingSeconds;

    function tick() {
      const mins = Math.floor(timeLeft / 60);
      const secs = timeLeft % 60;
      activeTimerBadge.textContent = `⏱ ${mins}:${secs < 10 ? '0' : ''}${secs}`;
      if (timeLeft <= 30) {
        activeTimerBadge.classList.add('urgent');
      } else {
        activeTimerBadge.classList.remove('urgent');
      }

      if (timeLeft <= 0) {
        clearInterval(timerInterval);
        activeTimerBadge.textContent = '⏱ Expired';
        activeStatusText.textContent = 'Payment expired after 120 seconds.';
      }
      timeLeft--;
    }

    tick();
    timerInterval = setInterval(tick, 1000);
  }

  async function handlePaymentDecision(action) {
    const state = merchantStore.getState();
    const txn = state.activeTxn;
    const m = state.currentMerchant;
    if (!txn || !m) return;

    try {
      const res = await apiClient.post('/api/merchant/payment-action', {
        merchantId: m.id,
        txnId: txn.id,
        action
      });

      if (action === 'approve') {
        if (res.completed === false) {
          // Multi-split progression: next chunk is active!
          soundManager.play('beep');
          setActiveTransaction(res.transaction, 120);
          activeStatusBanner.className = 'active-status-banner approved';
          activeStatusBanner.style.background = '#e0f2fe';
          activeStatusBanner.style.color = '#0369a1';
          activeStatusText.textContent = `✓ Chunk approved! Next chunk (Payload ${res.transaction.current_part_index}) is active.`;
          syncMerchantState();
        } else {
          soundManager.play('chime');
          setActiveTransaction(null);
          syncMerchantState();
        }
      } else {
        soundManager.play('alert');
        setActiveTransaction(null);
        syncMerchantState();
      }
    } catch (err) {
      alert('Error recording decision: ' + err.message);
    }
  }

  /* ==========================================================================
     SYNC, TERMINAL SLOTS & METRICS
     ========================================================================== */

  function renderSlots(slots, slotInfo) {
    const counter = document.getElementById('dashSlotsCounter');
    const activeCount = (slotInfo && slotInfo.connectedCount) || 0;
    if (counter) counter.textContent = `${activeCount}/2`;

    const ind1 = document.getElementById('slotIndicator1');
    const txt1 = document.getElementById('slotText1');
    const ind2 = document.getElementById('slotIndicator2');
    const txt2 = document.getElementById('slotText2');

    if (ind1 && txt1) {
      if (activeCount >= 1) {
        ind1.className = 'slot-pill active';
        txt1.textContent = 'User 1 Connected (Slot 1/2)';
      } else {
        ind1.className = 'slot-pill';
        txt1.textContent = 'Available (0/2)';
      }
    }

    if (ind2 && txt2) {
      if (activeCount >= 2) {
        ind2.className = 'slot-pill active';
        txt2.textContent = 'User 2 Connected (Slot 2/2)';
      } else {
        ind2.className = 'slot-pill';
        txt2.textContent = 'Available (1/2)';
      }
    }
  }

  async function syncMerchantState() {
    const m = merchantStore.getState().currentMerchant;
    if (!m) return;

    try {
      const data = await apiClient.get(`/api/merchant/sync/${m.id}`);
      if (!data.success) return;

      if (data.slots || data.slotInfo) {
        renderSlots(data.slots || [], data.slotInfo);
      }

      if (data.stats) {
        statTotalRevenue.textContent = appUtils.formatCurrency(data.stats.totalRevenue);
        statTodayRevenue.textContent = appUtils.formatCurrency(data.stats.todayRevenue);
        statApprovedCount.textContent = data.stats.approvedCount;
        statDeniedCount.textContent = data.stats.deniedCount;
      }

      if (data.transactions) {
        renderTransactions(data.transactions);
      }

      if (data.activePayment) {
        const ap = data.activePayment;
        const currentActive = merchantStore.getState().activeTxn;
        if (!currentActive || currentActive.id !== ap.id || currentActive.current_part_index !== ap.current_part_index) {
          setActiveTransaction({
            id: ap.id,
            merchant_id: m.id,
            user_code: ap.user_code,
            total_amount: ap.total_amount,
            split_count: ap.split_count,
            current_part_index: ap.current_part_index,
            chunks: [ap.currentChunk]
          }, ap.remainingSeconds || 120);
        }

        if (ap.status === 'submitted') {
          activeStatusBanner.className = 'active-status-banner submitted';
          activeStatusText.textContent = '🔔 Customer submitted payment for verification.';
          if (ap.utr) {
            activeUtrBox.classList.remove('hidden');
            activeUtrVal.textContent = ap.utr;
          }
        }
      }
    } catch (e) {
      // Sync poll failure ignored
    }
  }

  function renderTransactions(txns) {
    if (!txnTableBody) return;
    if (!txns || txns.length === 0) {
      txnTableBody.innerHTML = '';
      if (noTxnsRow) txnTableBody.appendChild(noTxnsRow);
      return;
    }

    txnTableBody.innerHTML = txns.map(t => {
      const statusClass = t.status === 'approved' ? 'status-approved' : (t.status === 'denied' ? 'status-denied' : 'status-pending');
      const splitsText = t.split_count > 1 ? `${t.split_count} parts (≤ ₹1999)` : 'Single';
      return `
        <tr>
          <td><code>${t.id.slice(0, 14)}...</code></td>
          <td><strong>${appUtils.formatCurrency(t.total_amount)}</strong></td>
          <td><span class="badge ${splitsText === 'Single' ? '' : 'live'}">${splitsText}</span></td>
          <td><code>${t.user_code || t.merchant_code}</code></td>
          <td><span class="status-pill ${statusClass}">${t.status.toUpperCase()}</span></td>
          <td><small>${appUtils.formatDate(t.created_at)}</small></td>
        </tr>
      `;
    }).join('');
  }

  function startSyncPolling() {
    if (pollInterval) clearInterval(pollInterval);
    syncMerchantState();
    pollInterval = setInterval(syncMerchantState, 2000);
  }

  /* ==========================================================================
     WEBSOCKET REAL-TIME CONNECTION
     ========================================================================== */

  function initWebSocket() {
    const m = merchantStore.getState().currentMerchant;
    if (!m) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'merchant_init',
          merchantId: m.id
        }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'slot_updated' || msg.type === 'merchant_ready') {
            renderSlots(msg.slots || [], msg.slotInfo);
          } else if (msg.type === 'user_payment_submitted') {
            soundManager.play('beep');
            activeStatusBanner.className = 'active-status-banner submitted';
            activeStatusText.textContent = '🔔 Customer submitted payment for verification.';
            if (msg.utr && msg.utr !== 'Not provided') {
              activeUtrBox.classList.remove('hidden');
              activeUtrVal.textContent = msg.utr;
            }
          } else if (msg.type === 'merchant_blocked') {
            alert('⚠️ ' + msg.message);
            location.reload();
          }
        } catch (e) {}
      };

      ws.onclose = () => {
        // Reconnect after delay if still authenticated
        setTimeout(() => {
          if (merchantStore.getState().currentMerchant) initWebSocket();
        }, 5000);
      };
    } catch (err) {}
  }

  /* ==========================================================================
     MODALS & UTILITY BUTTONS
     ========================================================================== */

  function initModalsAndTools() {
    // Terminal 3 Warning Test
    if (testTerminal3Btn && terminal3WarningBanner) {
      testTerminal3Btn.addEventListener('click', async () => {
        terminal3WarningBanner.classList.remove('hidden');
        soundManager.play('alert');
        try { await apiClient.get('/api/terminal/3'); } catch (e) {}
      });
    }

    if (closeWarningBtn && terminal3WarningBanner) {
      closeWarningBtn.addEventListener('click', () => {
        terminal3WarningBanner.classList.add('hidden');
      });
    }

    // Copy Merchant Code
    if (copyMerchantCodeBtn) {
      copyMerchantCodeBtn.addEventListener('click', () => {
        const m = merchantStore.getState().currentMerchant;
        const code = (m && m.merchant_code) || document.getElementById('dashMerchantCode').textContent || '999999';
        appUtils.copyToClipboard(code, copyMerchantCodeBtn);
      });
    }

    // Phone Connect Modal (LAN QR)
    if (phoneQrModalBtn && phoneConnectModal) {
      phoneQrModalBtn.addEventListener('click', async () => {
        const m = merchantStore.getState().currentMerchant;
        const code = (m && m.merchant_code) || '999999';
        let host = window.location.host;

        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
          try {
            const net = await apiClient.get('/api/network-info');
            if (net.ip && net.ip !== '127.0.0.1') {
              host = `${net.ip}:${net.port || 3000}`;
            }
          } catch (e) {}
        }

        const phoneUrl = `${window.location.protocol}//${host}/user.html?code=${encodeURIComponent(code)}`;
        if (phoneTerminalUrlText) phoneTerminalUrlText.textContent = phoneUrl;

        if (phoneTerminalQrImg) {
          try {
            const qr = await apiClient.get('/api/qr', { text: phoneUrl });
            if (qr.dataUrl) phoneTerminalQrImg.src = qr.dataUrl;
          } catch (e) {
            phoneTerminalQrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(phoneUrl)}`;
          }
        }

        phoneConnectModal.classList.remove('hidden');
      });
    }

    if (closePhoneModalBtn && phoneConnectModal) {
      closePhoneModalBtn.addEventListener('click', () => phoneConnectModal.classList.add('hidden'));
      phoneConnectModal.addEventListener('click', (e) => {
        if (e.target === phoneConnectModal) phoneConnectModal.classList.add('hidden');
      });
    }

    if (copyPhoneUrlBtn && phoneTerminalUrlText) {
      copyPhoneUrlBtn.addEventListener('click', () => {
        appUtils.copyToClipboard(phoneTerminalUrlText.textContent, copyPhoneUrlBtn);
      });
    }
  }

  // Restore saved session on page load
  function restoreSession() {
    const saved = localStorage.getItem('slipte_merchant_session');
    if (saved) {
      try {
        const m = JSON.parse(saved);
        apiClient.get(`/api/merchant/me/${m.id}`).then(res => {
          if (res.success) handleLoginSuccess(res.merchant);
        }).catch(() => {
          localStorage.removeItem('slipte_merchant_session');
        });
      } catch (e) {
        localStorage.removeItem('slipte_merchant_session');
      }
    }
  }

  // Boot Application
  document.addEventListener('DOMContentLoaded', () => {
    initAuthTabs();
    initPaymentRequestEvents();
    initModalsAndTools();
    restoreSession();
  });

})(window, document);
