/**
 * @file merchantApp.js
 * @description Merchant Portal application controller with dynamic view mounting,
 * circular countdown timer, live WebSocket badge, and accessible table controls.
 */

(function (window, document) {
  'use strict';

  const { merchantStore, apiClient, soundManager, appUtils, uiComponents } = window;

  let wsManager = null;
  let timerRing = null;
  let tableController = null;
  let pollInterval = null;
  let appConfig = { demoMode: true };

  // Core Layout Containers
  const mainAppContainer = document.getElementById('mainAppContainer');
  const authTemplate = document.getElementById('authViewTemplate');
  const dashboardTemplate = document.getElementById('dashboardViewTemplate');
  const wsConnBadge = document.getElementById('wsConnBadge');
  const navUserSection = document.getElementById('navUserSection');
  const navMerchantPhone = document.getElementById('navMerchantPhone');
  const tryDemoNavBtn = document.getElementById('tryDemoNavBtn');
  const logoutBtn = document.getElementById('logoutBtn');

  // Phone Connect Modal Elements
  const phoneConnectModal = document.getElementById('phoneConnectModal');
  const closePhoneModalBtn = document.getElementById('closePhoneModalBtn');
  const phoneTerminalQrImg = document.getElementById('phoneTerminalQrImg');
  const phoneTerminalUrlText = document.getElementById('phoneTerminalUrlText');
  const copyPhoneUrlBtn = document.getElementById('copyPhoneUrlBtn');

  /* ==========================================================================
     VIEW MOUNTING SYSTEM (SHOW ONLY ONE STATE PER SCREEN)
     ========================================================================== */

  let currentViewName = null;

  function renderView(viewName) {
    if (!mainAppContainer) return;
    currentViewName = viewName;
    mainAppContainer.innerHTML = '';

    if (viewName === 'auth') {
      if (authTemplate) {
        const clone = authTemplate.content.cloneNode(true);
        mainAppContainer.appendChild(clone);
        bindAuthView();
      }
    } else if (viewName === 'dashboard') {
      if (dashboardTemplate) {
        const clone = dashboardTemplate.content.cloneNode(true);
        mainAppContainer.appendChild(clone);
        bindDashboardView();
      }
    }
  }

  /* ==========================================================================
     AUTHENTICATION VIEW BINDING
     ========================================================================== */

  function bindAuthView() {
    navUserSection.classList.add('hidden');

    const tabLogin = document.getElementById('tabLogin');
    const tabRegister = document.getElementById('tabRegister');
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const loginAlert = document.getElementById('loginAlert');
    const regAlert = document.getElementById('regAlert');
    const tryDemoBtn = document.getElementById('tryDemoBtn');
    const fillDemoCredsBtn = document.getElementById('fillDemoCredsBtn');
    const demoBanner = document.getElementById('demoSandboxBanner');
    const demoAutofillBox = document.getElementById('demoAutofillBox');

    // Hide demo features if DEMO_MODE is disabled in environment
    if (!appConfig.demoMode) {
      if (demoBanner) demoBanner.classList.add('hidden');
      if (demoAutofillBox) demoAutofillBox.classList.add('hidden');
      if (tryDemoNavBtn) tryDemoNavBtn.classList.add('hidden');
    } else {
      if (tryDemoNavBtn) tryDemoNavBtn.classList.remove('hidden');
    }

    if (tabLogin && tabRegister) {
      tabLogin.addEventListener('click', () => {
        tabLogin.classList.add('active');
        tabLogin.setAttribute('aria-selected', 'true');
        tabRegister.classList.remove('active');
        tabRegister.setAttribute('aria-selected', 'false');
        if (loginForm) loginForm.classList.remove('hidden');
        if (registerForm) registerForm.classList.add('hidden');
      });

      tabRegister.addEventListener('click', () => {
        tabRegister.classList.add('active');
        tabRegister.setAttribute('aria-selected', 'true');
        tabLogin.classList.remove('active');
        tabLogin.setAttribute('aria-selected', 'false');
        if (registerForm) registerForm.classList.remove('hidden');
        if (loginForm) loginForm.classList.add('hidden');
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

    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (loginAlert) loginAlert.classList.add('hidden');

        const phone = document.getElementById('loginPhone').value.trim();
        const password = document.getElementById('loginPassword').value;

        try {
          const res = await apiClient.post('/api/merchant/login', { phone, password });
          handleLoginSuccess(res.merchant);
        } catch (err) {
          if (loginAlert) {
            loginAlert.textContent = '❌ ' + err.message;
            loginAlert.className = 'alert error';
            loginAlert.classList.remove('hidden');
          }
        }
      });
    }

    const regSubmitBtn = document.getElementById('regSubmitBtn');
    if (regSubmitBtn) {
      regSubmitBtn.addEventListener('click', async () => {
        if (regAlert) regAlert.classList.add('hidden');
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
          if (regAlert) {
            regAlert.textContent = `🎉 Account registered! Assigned code: ${res.merchant.merchant_code}`;
            regAlert.className = 'alert success';
            regAlert.classList.remove('hidden');
          }
          setTimeout(() => handleLoginSuccess(res.merchant), 600);
        } catch (err) {
          if (regAlert) {
            regAlert.textContent = '❌ ' + err.message;
            regAlert.className = 'alert error';
            regAlert.classList.remove('hidden');
          }
        }
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

    try {
      localStorage.setItem('slipte_merchant_session', JSON.stringify(merchant));
    } catch (e) {}

    renderView('dashboard');
  }

  /* ==========================================================================
     DASHBOARD VIEW BINDING
     ========================================================================== */

  function bindDashboardView() {
    const merchant = merchantStore.getState().currentMerchant;
    if (!merchant) {
      renderView('auth');
      return;
    }

    // Update Header Navigation
    navUserSection.classList.remove('hidden');
    if (tryDemoNavBtn) tryDemoNavBtn.classList.add('hidden');

    const isDemo = merchant.is_demo || merchant.merchant_code === '999999' || merchant.merchant_code === 'MC-99';
    navMerchantPhone.textContent = merchant.phone + (isDemo ? ' [Demo]' : '');

    // Overview Card
    const dashPhone = document.getElementById('dashMerchantPhone');
    const dashUpi = document.getElementById('dashMerchantUpi');
    if (dashPhone) dashPhone.textContent = merchant.phone;
    if (dashUpi) dashUpi.textContent = merchant.upi_id || 'paytm.s1m66cw@pty';

    // 6-digit assigned code
    const code = merchant.merchant_code || (merchant.user_codes && merchant.user_codes[0]) || '999999';
    const codeEl = document.getElementById('dashMerchantCode');
    if (codeEl) codeEl.textContent = code;

    // Terminal Quick Link
    const openTerminalLink = document.getElementById('openTerminalLink');
    if (openTerminalLink) {
      openTerminalLink.href = `/user.html?code=${encodeURIComponent(code)}`;
      openTerminalLink.addEventListener('click', () => {
        const m = merchantStore.getState().currentMerchant;
        const currentCode = (m && m.merchant_code) || code;
        openTerminalLink.href = `/user.html?code=${encodeURIComponent(currentCode)}`;
      });
    }

    // Copy Code Button
    const copyMerchantCodeBtn = document.getElementById('copyMerchantCodeBtn');
    if (copyMerchantCodeBtn) {
      copyMerchantCodeBtn.addEventListener('click', () => {
        const m = merchantStore.getState().currentMerchant;
        const c = (m && m.merchant_code) || code;
        appUtils.copyToClipboard(c, copyMerchantCodeBtn);
        uiComponents.showToast('📋 6-digit code copied to clipboard!', 'success');
      });
    }

    // Terminal 3 Warning Test Button
    const testTerminal3Btn = document.getElementById('testTerminal3Btn');
    const terminal3WarningBanner = document.getElementById('terminal3WarningBanner');
    const closeWarningBtn = document.getElementById('closeWarningBtn');

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

    // Phone QR Modal Trigger
    const phoneQrModalBtn = document.getElementById('phoneQrModalBtn');
    if (phoneQrModalBtn) {
      phoneQrModalBtn.addEventListener('click', handleOpenPhoneModal);
    }

    // Multi-UPI Dropdown & Dynamic Inputs
    initUpiInputControls(merchant.upi_ids || [merchant.upi_id || 'paytm.s1m66cw@pty']);

    // Amount & Auto-Split Form
    const amountInput = document.getElementById('paymentAmount');
    if (amountInput) {
      amountInput.addEventListener('input', updateSplitPreview);
    }

    const paymentRequestForm = document.getElementById('paymentRequestForm');
    if (paymentRequestForm) {
      paymentRequestForm.addEventListener('submit', handlePaymentRequestSubmit);
    }

    // Decision Buttons
    const approvePaymentBtn = document.getElementById('approvePaymentBtn');
    if (approvePaymentBtn) {
      approvePaymentBtn.addEventListener('click', () => handlePaymentDecision('approve'));
    }

    const denyPaymentBtn = document.getElementById('denyPaymentBtn');
    if (denyPaymentBtn) {
      denyPaymentBtn.addEventListener('click', () => {
        uiComponents.showConfirmDialog({
          title: 'Deny Payment Request?',
          message: 'Are you sure you want to deny this transaction? The linked customer terminal will be updated immediately.',
          confirmText: '✕ Yes, Deny Transaction',
          confirmClass: 'btn-danger',
          icon: '🚫',
          onConfirm: () => handlePaymentDecision('deny')
        });
      });
    }

    const refreshStatsBtn = document.getElementById('refreshStatsBtn');
    if (refreshStatsBtn) {
      refreshStatsBtn.addEventListener('click', syncMerchantState);
    }

    // Setup Table Controller with Search, Filter & Pagination
    setupTransactionsTable();

    // Setup Real-time WebSocket with Live Connection Badge
    setupWebSocket();

    // Start background sync polling
    startSyncPolling();
  }

  /* ==========================================================================
     MULTI-UPI CONTROLS & AUTO-SPLIT PREVIEW
     ========================================================================== */

  function initUpiInputControls(initialUpis) {
    const upiCountSelect = document.getElementById('upiCountSelect');
    const dynamicUpiContainer = document.getElementById('dynamicUpiInputs');
    const saveUpiBtn = document.getElementById('saveUpiBtn');
    if (!upiCountSelect || !dynamicUpiContainer) return;

    const upis = Array.isArray(initialUpis) && initialUpis.length > 0
      ? initialUpis.filter(u => u && u.includes('@'))
      : ['paytm.s1m66cw@pty'];

    const count = Math.min(5, Math.max(1, upis.length));
    upiCountSelect.value = String(count);

    renderDynamicUpiInputs(count, upis);

    upiCountSelect.addEventListener('change', () => {
      renderDynamicUpiInputs(parseInt(upiCountSelect.value, 10) || 1);
    });

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

          const dashUpi = document.getElementById('dashMerchantUpi');
          if (dashUpi) dashUpi.textContent = upiList[0];

          uiComponents.showToast(`💾 Saved ${upiList.length} destination UPI IDs!`, 'success');
          updateSplitPreview();
        } catch (err) {
          alert('Failed to save UPI IDs: ' + err.message);
        }
      });
    }
  }

  function renderDynamicUpiInputs(count, existingValues = []) {
    const dynamicUpiContainer = document.getElementById('dynamicUpiInputs');
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
    const dynamicUpiContainer = document.getElementById('dynamicUpiInputs');
    if (!dynamicUpiContainer) return ['paytm.s1m66cw@pty'];
    const inputs = Array.from(dynamicUpiContainer.querySelectorAll('.upi-row-input'));
    const values = inputs.map(i => i.value.trim()).filter(v => v && v.includes('@'));
    if (values.length > 0) return values;
    const m = merchantStore.getState().currentMerchant;
    return [(m && m.upi_id) || 'paytm.s1m66cw@pty'];
  }

  function updateSplitPreview() {
    const amountInput = document.getElementById('paymentAmount');
    const splitTitle = document.getElementById('splitPreviewTitle');
    const splitPills = document.getElementById('splitPillsContainer');
    const pushPaymentBtn = document.getElementById('pushPaymentBtn');
    if (!amountInput || !splitTitle || !splitPills) return;

    const val = parseFloat(amountInput.value);
    const upiList = getActiveUpiList();

    if (!val || isNaN(val) || val <= 0) {
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
      splitTitle.textContent = `Condition B (Amount > ₹1999): Auto-Split into ${parts.length} Payloads (${upiList.length > 1 ? `Cycling across ${upiList.length} Merchant UPIs` : 'Max ₹1999 each'})`;
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

  async function handlePaymentRequestSubmit(e) {
    e.preventDefault();
    const amountInput = document.getElementById('paymentAmount');
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
      uiComponents.showToast(`🚀 Payload 1 pushed to customer terminal!`, 'info');
    } catch (err) {
      alert('Error creating payment: ' + err.message);
    }
  }

  /* ==========================================================================
     ACTIVE TRANSACTION CONTROLLER & TIMER RING
     ========================================================================== */

  function setActiveTransaction(txn, remainingSeconds = 120) {
    merchantStore.setState({ activeTxn: txn });
    if (timerRing) timerRing.stop();

    const noActiveTxnMsg = document.getElementById('noActiveTxnMsg');
    const activeTxnDetails = document.getElementById('activeTxnDetails');
    const activeTimerRingBox = document.getElementById('activeTimerRingBox');
    const activeChunkTag = document.getElementById('activeChunkTag');
    const activeTotalTag = document.getElementById('activeTotalTag');
    const activeAmountVal = document.getElementById('activeAmountVal');
    const activeSplitSubtext = document.getElementById('activeSplitSubtext');
    const activeStatusBanner = document.getElementById('activeStatusBanner');
    const activeStatusText = document.getElementById('activeStatusText');
    const activeUtrBox = document.getElementById('activeUtrBox');
    const controllerHint = document.getElementById('controllerHint');

    if (!txn) {
      if (noActiveTxnMsg) noActiveTxnMsg.classList.remove('hidden');
      if (activeTxnDetails) activeTxnDetails.classList.add('hidden');
      if (activeTimerRingBox) activeTimerRingBox.classList.add('hidden');
      return;
    }

    if (noActiveTxnMsg) noActiveTxnMsg.classList.add('hidden');
    if (activeTxnDetails) activeTxnDetails.classList.remove('hidden');
    if (activeTimerRingBox) activeTimerRingBox.classList.remove('hidden');

    const currentIdx = (txn.current_part_index || 1) - 1;
    const currentChunk = (txn.chunks && txn.chunks[currentIdx]) || { amount: txn.total_amount };
    const chunkUpi = currentChunk.upi_id || txn.merchant_upi_id || 'paytm.s1m66cw@pty';

    if (activeChunkTag) activeChunkTag.textContent = `Payload ${txn.current_part_index || 1} of ${txn.split_count || 1}`;
    if (activeTotalTag) activeTotalTag.textContent = `Total: ${appUtils.formatCurrency(txn.total_amount)}`;
    if (activeAmountVal) activeAmountVal.textContent = appUtils.formatCurrency(currentChunk.amount);
    if (activeSplitSubtext) {
      activeSplitSubtext.textContent = txn.split_count > 1
        ? `Sequential Chunk ${txn.current_part_index || 1} of ${txn.split_count} • Receiving on ${chunkUpi}`
        : `Single Payment Payload • Receiving on ${chunkUpi}`;
    }

    if (activeStatusBanner) {
      activeStatusBanner.className = 'active-status-banner';
      activeStatusBanner.style.background = '';
      activeStatusBanner.style.color = '';
    }
    if (activeStatusText) activeStatusText.textContent = 'Waiting for customer to scan QR on terminal...';
    if (activeUtrBox) activeUtrBox.classList.add('hidden');

    if (controllerHint) {
      if (txn.split_count > 1 && (txn.current_part_index || 1) < txn.split_count) {
        controllerHint.textContent = `⚡ Approving will update sales stats (+${appUtils.formatCurrency(currentChunk.amount)}) and push Payload ${(txn.current_part_index || 1) + 1} to user.`;
      } else {
        controllerHint.textContent = 'Verify incoming funds in your Paytm app before approving.';
      }
    }

    // Start Circular Timer Ring
    const ringCircle = document.getElementById('timerRingCircle');
    const timerDigits = document.getElementById('activeTimerDigits');

    timerRing = uiComponents.createTimerRing({
      ringCircleEl: ringCircle,
      timerDigitsEl: timerDigits,
      duration: 120,
      onExpire: () => {
        if (activeStatusText) activeStatusText.textContent = '⏱ Payment expired after 120 seconds.';
      }
    });

    timerRing.reset(remainingSeconds);
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
          soundManager.play('beep');
          setActiveTransaction(res.transaction, 120);
          uiComponents.showToast(`✓ Chunk approved! Payload ${res.transaction.current_part_index} is now active.`, 'success');
          syncMerchantState();
        } else {
          soundManager.play('chime');
          setActiveTransaction(null);
          uiComponents.showToast('✓ Payment approved successfully!', 'success');
          syncMerchantState();
        }
      } else {
        soundManager.play('alert');
        setActiveTransaction(null);
        uiComponents.showToast('✕ Transaction was denied.', 'info');
        syncMerchantState();
      }
    } catch (err) {
      alert('Error recording decision: ' + err.message);
    }
  }

  /* ==========================================================================
     TRANSACTIONS TABLE CONTROLLER (SEARCH, FILTER, PAGINATION, CARDS)
     ========================================================================== */

  function setupTransactionsTable() {
    const tbody = document.getElementById('txnTableBody');
    const searchInput = document.getElementById('txnSearchInput');
    const statusFilter = document.getElementById('txnStatusFilter');
    const prevBtn = document.getElementById('txnPrevPage');
    const nextBtn = document.getElementById('txnNextPage');
    const pageInfo = document.getElementById('txnPageInfo');

    tableController = uiComponents.createTableController({
      tbodyEl: tbody,
      searchInputEl: searchInput,
      filterSelectEl: statusFilter,
      prevBtnEl: prevBtn,
      nextBtnEl: nextBtn,
      pageInfoEl: pageInfo,
      pageSize: 5,
      renderRowHtml: (t) => {
        const statusClass = t.status === 'approved' ? 'status-approved' : (t.status === 'denied' ? 'status-denied' : 'status-pending');
        const splitsText = t.split_count > 1 ? `${t.split_count} parts (≤ ₹1999)` : 'Single';
        return `
          <tr>
            <td data-label="TXN ID"><code>${t.id.slice(0, 14)}...</code></td>
            <td data-label="Amount"><strong>${appUtils.formatCurrency(t.total_amount)}</strong></td>
            <td data-label="Splits"><span class="badge ${splitsText === 'Single' ? '' : 'live'}">${splitsText}</span></td>
            <td data-label="Customer Slot"><code>${t.user_code || t.merchant_code}</code></td>
            <td data-label="Status"><span class="status-pill ${statusClass}">${t.status.toUpperCase()}</span></td>
            <td data-label="Time"><small>${appUtils.formatDate(t.created_at)}</small></td>
          </tr>
        `;
      }
    });
  }

  /* ==========================================================================
     SLOTS & BACKGROUND SYNC POLLING
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

      const statTotalRev = document.getElementById('statTotalRevenue');
      const statTodayRev = document.getElementById('statTodayRevenue');
      const statApprCount = document.getElementById('statApprovedCount');
      const statDenCount = document.getElementById('statDeniedCount');

      if (data.stats) {
        if (statTotalRev) statTotalRev.textContent = appUtils.formatCurrency(data.stats.totalRevenue);
        if (statTodayRev) statTodayRev.textContent = appUtils.formatCurrency(data.stats.todayRevenue);
        if (statApprCount) statApprCount.textContent = data.stats.approvedCount;
        if (statDenCount) statDenCount.textContent = data.stats.deniedCount;
      }

      if (data.transactions && tableController) {
        tableController.setData(data.transactions);
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

        const activeStatusBanner = document.getElementById('activeStatusBanner');
        const activeStatusText = document.getElementById('activeStatusText');
        const activeUtrBox = document.getElementById('activeUtrBox');
        const activeUtrVal = document.getElementById('activeUtrVal');

        if (ap.status === 'submitted') {
          if (activeStatusBanner) activeStatusBanner.className = 'active-status-banner submitted';
          if (activeStatusText) activeStatusText.textContent = '🔔 Customer submitted payment for verification.';
          if (ap.utr && activeUtrBox && activeUtrVal) {
            activeUtrBox.classList.remove('hidden');
            activeUtrVal.textContent = ap.utr;
          }
        }
      }
    } catch (e) {}
  }

  function startSyncPolling() {
    if (pollInterval) clearInterval(pollInterval);
    syncMerchantState();
    pollInterval = setInterval(syncMerchantState, 2000);
  }

  /* ==========================================================================
     WEBSOCKET REAL-TIME CONNECTION
     ========================================================================== */

  function setupWebSocket() {
    const m = merchantStore.getState().currentMerchant;
    if (!m) return;

    if (wsManager) wsManager.close();

    wsManager = uiComponents.setupWebSocketWithBadge({
      badgeEl: wsConnBadge,
      onOpen: (ws) => {
        ws.send(JSON.stringify({
          type: 'merchant_init',
          merchantId: m.id
        }));
      },
      onMessage: (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'slot_updated' || msg.type === 'merchant_ready') {
            renderSlots(msg.slots || [], msg.slotInfo);
          } else if (msg.type === 'user_payment_submitted') {
            soundManager.play('beep');
            const activeStatusBanner = document.getElementById('activeStatusBanner');
            const activeStatusText = document.getElementById('activeStatusText');
            const activeUtrBox = document.getElementById('activeUtrBox');
            const activeUtrVal = document.getElementById('activeUtrVal');

            if (activeStatusBanner) activeStatusBanner.className = 'active-status-banner submitted';
            if (activeStatusText) activeStatusText.textContent = '🔔 Customer submitted payment for verification.';
            if (msg.utr && msg.utr !== 'Not provided' && activeUtrBox && activeUtrVal) {
              activeUtrBox.classList.remove('hidden');
              activeUtrVal.textContent = msg.utr;
            }
          } else if (msg.type === 'merchant_blocked') {
            alert('⚠️ ' + msg.message);
            location.reload();
          }
        } catch (e) {}
      }
    });
  }

  /* ==========================================================================
     PHONE QR MODAL
     ========================================================================== */

  async function handleOpenPhoneModal() {
    const m = merchantStore.getState().currentMerchant;
    const code = (m && m.merchant_code) || '999999';
    let host = window.location.host;

    const phoneNetworkAdapterName = document.getElementById('phoneNetworkAdapterName');

    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      try {
        const net = await apiClient.get('/api/network-info');
        if (net.ip && net.ip !== '127.0.0.1') {
          host = `${net.ip}:${net.port || 3000}`;
          if (phoneNetworkAdapterName) {
            phoneNetworkAdapterName.textContent = `${net.adapterName || 'Wi-Fi'} (${net.ip})`;
          }
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

    if (phoneConnectModal) phoneConnectModal.classList.remove('hidden');
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
      uiComponents.showToast('📋 Phone pairing URL copied!', 'success');
    });
  }

  // Logout Handler
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      try { localStorage.removeItem('slipte_merchant_session'); } catch (e) {}
      if (wsManager) wsManager.close();
      if (timerRing) timerRing.stop();
      clearInterval(pollInterval);
      merchantStore.setState({ currentMerchant: null, activeTxn: null });
      renderView('auth');
    });
  }

  if (tryDemoNavBtn) {
    tryDemoNavBtn.addEventListener('click', handleLaunchDemo);
  }

  /* ==========================================================================
     BOOTSTRAP & CONFIGURATION
     ========================================================================== */

  async function init() {
    // 1. Fetch system configuration (including DEMO_MODE)
    try {
      const cfg = await apiClient.get('/api/config');
      if (cfg && cfg.success) {
        appConfig = cfg;
      }
    } catch (e) {}

    // 2. Check for saved session
    const saved = localStorage.getItem('slipte_merchant_session');
    if (saved) {
      try {
        const m = JSON.parse(saved);
        const res = await apiClient.get(`/api/merchant/me/${m.id}`);
        if (res.success) {
          handleLoginSuccess(res.merchant);
          return;
        }
      } catch (e) {
        localStorage.removeItem('slipte_merchant_session');
      }
    }

    // Default to Auth View
    renderView('auth');
  }

  document.addEventListener('DOMContentLoaded', init);

})(window, document);
