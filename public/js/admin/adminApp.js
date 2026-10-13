/**
 * @file adminApp.js
 * @description Platform Administration application controller featuring dynamic single-view mounting,
 * live WebSocket connection badge, confirmation dialogs, toast notifications, search, status filter,
 * pagination, and mobile card view.
 */

(function (window, document) {
  'use strict';

  const { adminStore, apiClient, appUtils, uiComponents } = window;

  let wsManager = null;
  let merchantsTableController = null;
  let txnsTableController = null;

  // Header Elements
  const adminMainContainer = document.getElementById('adminMainContainer');
  const adminConnBadge = document.getElementById('adminConnBadge');
  const adminNavUser = document.getElementById('adminNavUser');
  const adminLoggedName = document.getElementById('adminLoggedName');
  const adminLogoutBtn = document.getElementById('adminLogoutBtn');
  const adminSettingsBtn = document.getElementById('adminSettingsBtn');

  // View Templates
  const adminLoginTemplate = document.getElementById('adminLoginTemplate');
  const adminDashboardTemplate = document.getElementById('adminDashboardTemplate');

  // Password Reset Modal Elements
  const passwordModal = document.getElementById('passwordModal');
  const resetMerchantPhoneEl = document.getElementById('resetMerchantPhone');
  const resetMerchantIdInput = document.getElementById('resetMerchantId');
  const newPasswordInput = document.getElementById('newPassword');
  const resetPasswordForm = document.getElementById('resetPasswordForm');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const cancelResetBtn = document.getElementById('cancelResetBtn');
  const resetModalAlert = document.getElementById('resetModalAlert');

  /* ==========================================================================
     VIEW MOUNTING SYSTEM (SHOW ONLY ONE STATE PER SCREEN)
     ========================================================================== */

  let currentViewName = null;

  function renderView(viewName) {
    if (!adminMainContainer) return;
    currentViewName = viewName;
    adminMainContainer.innerHTML = '';

    if (viewName === 'login') {
      if (adminNavUser) adminNavUser.classList.add('hidden');
      if (adminLoginTemplate) {
        const clone = adminLoginTemplate.content.cloneNode(true);
        adminMainContainer.appendChild(clone);
        bindLoginView();
      }
    } else if (viewName === 'dashboard') {
      if (adminNavUser) adminNavUser.classList.remove('hidden');
      if (adminDashboardTemplate) {
        const clone = adminDashboardTemplate.content.cloneNode(true);
        adminMainContainer.appendChild(clone);
        bindDashboardView();
      }
    }
  }

  /* ==========================================================================
     LOGIN VIEW BINDINGS
     ========================================================================== */

  function bindLoginView() {
    const form = document.getElementById('adminLoginForm');
    const userInp = document.getElementById('adminUsername');
    const passInp = document.getElementById('adminPassword');
    const alertBox = document.getElementById('adminLoginAlert');
    const submitBtn = document.getElementById('adminLoginSubmitBtn');

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (alertBox) alertBox.classList.add('hidden');

        const username = userInp ? userInp.value.trim() : '';
        const password = passInp ? passInp.value : '';

        if (!username || !password) {
          if (alertBox) {
            alertBox.textContent = 'Please provide both username and password.';
            alertBox.className = 'alert error';
            alertBox.classList.remove('hidden');
          }
          return;
        }

        try {
          if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Authenticating...';
          }

          const res = await apiClient.post('/api/admin/login', { username, password });
          localStorage.setItem('slipte_admin_token', res.token);
          if (adminLoggedName) adminLoggedName.textContent = res.admin ? res.admin.username : username;
          adminStore.setState({ isAuthenticated: true });

          uiComponents.showToast('Administrator authenticated successfully', 'success');
          renderView('dashboard');
        } catch (err) {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Authenticate →';
          }
          if (alertBox) {
            alertBox.textContent = '❌ ' + (err.message || 'Authentication failed');
            alertBox.className = 'alert error';
            alertBox.classList.remove('hidden');
          }
        }
      });
    }
  }

  /* ==========================================================================
     DASHBOARD VIEW BINDINGS
     ========================================================================== */

  function bindDashboardView() {
    // KPI elements
    const kpiMerchants = document.getElementById('kpiTotalMerchants');
    const kpiActive = document.getElementById('kpiActiveMerchants');
    const kpiBlocked = document.getElementById('kpiBlockedMerchants');
    const kpiGmv = document.getElementById('kpiTotalGmv');

    // Action buttons
    const clearFakeDataBtn = document.getElementById('clearFakeDataBtn');
    const refreshMerchantsBtn = document.getElementById('refreshMerchantsBtn');
    const refreshTxnsBtn = document.getElementById('refreshTxnsBtn');

    // Merchants Table Elements
    const merchantsTableBody = document.getElementById('merchantsTableBody');
    const merchantSearchInput = document.getElementById('merchantSearchInput');
    const merchantStatusFilter = document.getElementById('merchantStatusFilter');
    const merchantsPrevBtn = document.getElementById('merchantsPrevBtn');
    const merchantsNextBtn = document.getElementById('merchantsNextBtn');
    const merchantsPageInfo = document.getElementById('merchantsPageInfo');

    // Transactions Table Elements
    const adminTxnsTableBody = document.getElementById('adminTxnsTableBody');
    const txnSearchInput = document.getElementById('txnSearchInput');
    const txnStatusFilter = document.getElementById('txnStatusFilter');
    const txnsPrevBtn = document.getElementById('txnsPrevBtn');
    const txnsNextBtn = document.getElementById('txnsNextBtn');
    const txnsPageInfo = document.getElementById('txnsPageInfo');

    // Show initial skeleton loaders
    renderSkeletonRows(merchantsTableBody, 7, 3);
    renderSkeletonRows(adminTxnsTableBody, 6, 4);

    // Initialize Merchants Table Controller
    merchantsTableController = uiComponents.createTableController({
      tbodyEl: merchantsTableBody,
      searchInputEl: merchantSearchInput,
      filterSelectEl: merchantStatusFilter,
      prevBtnEl: merchantsPrevBtn,
      nextBtnEl: merchantsNextBtn,
      pageInfoEl: merchantsPageInfo,
      pageSize: 8,
      emptyMessage: 'No merchants found matching your query.',
      renderRowHtml: (m) => {
        const isBlocked = m.status === 'blocked';
        const statusBadge = isBlocked
          ? '<span class="status-pill status-denied">BLOCKED</span>'
          : '<span class="status-pill status-approved">ACTIVE</span>';

        const actionBtn = isBlocked
          ? `<button type="button" class="btn btn-sm btn-outline" onclick="window.adminActions.confirmUnblock('${m.id}', '${m.phone}', '${m.merchant_code || ''}')">✓ Unblock</button>`
          : `<button type="button" class="btn btn-sm btn-danger" onclick="window.adminActions.confirmBlock('${m.id}', '${m.phone}', '${m.merchant_code || ''}')">🚫 Block</button>`;

        const resetBtn = `<button type="button" class="btn btn-sm btn-secondary" onclick="window.adminActions.openPasswordModal('${m.id}', '${m.phone}')">🔑 Reset Pass</button>`;

        const upiDisplay = Array.isArray(m.upi_ids) && m.upi_ids.length > 1
          ? `${m.upi_id} <span class="text-muted" style="font-size: 0.75rem;">(+${m.upi_ids.length - 1} more)</span>`
          : (m.upi_id || 'merchant@paytm');

        return `
          <tr>
            <td data-label="Assigned Code"><strong><code>${m.merchant_code || '------'}</code></strong></td>
            <td data-label="Merchant Phone">${m.phone}</td>
            <td data-label="Provider"><span class="badge live">Paytm</span></td>
            <td data-label="Registered UPI IDs"><small>${upiDisplay}</small></td>
            <td data-label="Account Status">${statusBadge}</td>
            <td data-label="Registered Date"><small class="text-muted">${appUtils.formatDate(m.created_at)}</small></td>
            <td data-label="Governance Actions">
              <div class="action-buttons-group" style="display: flex; gap: 6px; justify-content: flex-end;">
                ${actionBtn}
                ${resetBtn}
              </div>
            </td>
          </tr>
        `;
      }
    });

    // Initialize Transactions Table Controller
    txnsTableController = uiComponents.createTableController({
      tbodyEl: adminTxnsTableBody,
      searchInputEl: txnSearchInput,
      filterSelectEl: txnStatusFilter,
      prevBtnEl: txnsPrevBtn,
      nextBtnEl: txnsNextBtn,
      pageInfoEl: txnsPageInfo,
      pageSize: 8,
      emptyMessage: 'No transactions recorded on platform.',
      renderRowHtml: (t) => {
        let statusBadge = '<span class="status-pill status-pending">PENDING</span>';
        if (t.status === 'approved') statusBadge = '<span class="status-pill status-approved">APPROVED</span>';
        else if (t.status === 'denied') statusBadge = '<span class="status-pill status-denied">DENIED</span>';

        const splits = (t.split_count > 1)
          ? `<span class="badge live">${t.split_count} Chunks (≤ ₹1999)</span>`
          : '<span class="badge">Single Payload</span>';

        return `
          <tr>
            <td data-label="TXN ID"><code>${(t.id || '').slice(0, 15)}...</code></td>
            <td data-label="Total Amount"><strong>${appUtils.formatCurrency(t.total_amount)}</strong></td>
            <td data-label="Assigned Code"><code>${t.merchant_code || t.user_code || '-'}</code></td>
            <td data-label="Split Chunks">${splits}</td>
            <td data-label="Payment Status">${statusBadge}</td>
            <td data-label="Created Time"><small class="text-muted">${appUtils.formatDate(t.created_at)}</small></td>
          </tr>
        `;
      }
    });

    // Button Listeners
    if (refreshMerchantsBtn) {
      refreshMerchantsBtn.addEventListener('click', loadDashboardData);
    }

    if (refreshTxnsBtn) {
      refreshTxnsBtn.addEventListener('click', loadDashboardData);
    }

    if (clearFakeDataBtn) {
      clearFakeDataBtn.addEventListener('click', () => {
        uiComponents.showConfirmDialog({
          title: 'Clear Test Data',
          message: 'Are you sure you want to clear non-demo test merchants and transactions? Demo account (999999) will be preserved.',
          confirmText: 'Clear Test Data',
          confirmClass: 'btn-danger',
          icon: '🧹',
          onConfirm: async () => {
            try {
              const res = await apiClient.post('/api/admin/clear-data', { keepDemo: true });
              uiComponents.showToast(`Test data cleared! Remaining merchants: ${res.counts.merchantsCount}`, 'success');
              loadDashboardData();
            } catch (err) {
              uiComponents.showToast('Failed to clear data: ' + err.message, 'error');
            }
          }
        });
      });
    }

    // Load initial data
    loadDashboardData();
  }

  function renderSkeletonRows(tbodyEl, colCount, rowCount) {
    if (!tbodyEl) return;
    let html = '';
    for (let i = 0; i < rowCount; i++) {
      html += `<tr class="skeleton-row">`;
      for (let j = 0; j < colCount; j++) {
        html += `<td><div class="skeleton-bar" style="width: ${j === 0 ? '60%' : '80%'}"></div></td>`;
      }
      html += `</tr>`;
    }
    tbodyEl.innerHTML = html;
  }

  async function loadDashboardData() {
    try {
      const [statsRes, merchantsRes, txnsRes] = await Promise.all([
        apiClient.get('/api/admin/stats'),
        apiClient.get('/api/admin/merchants'),
        apiClient.get('/api/admin/transactions')
      ]);

      if (statsRes.success) {
        const s = statsRes.stats;
        const kpiMerchants = document.getElementById('kpiTotalMerchants');
        const kpiActive = document.getElementById('kpiActiveMerchants');
        const kpiBlocked = document.getElementById('kpiBlockedMerchants');
        const kpiGmv = document.getElementById('kpiTotalGmv');

        if (kpiMerchants) kpiMerchants.textContent = s.totalMerchants;
        if (kpiActive) kpiActive.textContent = s.activeMerchants;
        if (kpiBlocked) kpiBlocked.textContent = (s.totalMerchants - s.activeMerchants);
        if (kpiGmv) kpiGmv.textContent = appUtils.formatCurrency(s.totalGMV);
      }

      if (merchantsRes.success && merchantsTableController) {
        merchantsTableController.setData(merchantsRes.merchants || []);
      }

      if (txnsRes.success && txnsTableController) {
        txnsTableController.setData(txnsRes.transactions || []);
      }
    } catch (err) {
      console.warn('Dashboard data fetch error:', err);
      uiComponents.showToast('Could not refresh admin data: ' + err.message, 'error');
    }
  }

  /* ==========================================================================
     ADMIN ACTIONS (CONFIRMATION DIALOGS & TOASTS)
     ========================================================================== */

  window.adminActions = {
    confirmBlock(merchantId, phone, code) {
      uiComponents.showConfirmDialog({
        title: 'Block Merchant Account',
        message: `Are you sure you want to block merchant ${phone} (${code})? Their customer terminals will be immediately disconnected.`,
        confirmText: 'Block Merchant',
        confirmClass: 'btn-danger',
        icon: '🚫',
        onConfirm: async () => {
          try {
            await apiClient.post('/api/admin/merchant-status', { merchantId, status: 'blocked' });
            uiComponents.showToast(`Merchant ${phone} has been blocked`, 'error');
            loadDashboardData();
          } catch (err) {
            uiComponents.showToast('Action failed: ' + err.message, 'error');
          }
        }
      });
    },

    confirmUnblock(merchantId, phone, code) {
      uiComponents.showConfirmDialog({
        title: 'Unblock Merchant Account',
        message: `Restore active terminal access for merchant ${phone} (${code})?`,
        confirmText: 'Unblock Merchant',
        confirmClass: 'btn-success',
        icon: '✅',
        onConfirm: async () => {
          try {
            await apiClient.post('/api/admin/merchant-status', { merchantId, status: 'active' });
            uiComponents.showToast(`Merchant ${phone} is now Active`, 'success');
            loadDashboardData();
          } catch (err) {
            uiComponents.showToast('Action failed: ' + err.message, 'error');
          }
        }
      });
    },

    openPasswordModal(merchantId, phone) {
      if (!passwordModal) return;
      if (resetMerchantIdInput) resetMerchantIdInput.value = merchantId;
      if (resetMerchantPhoneEl) resetMerchantPhoneEl.textContent = phone;
      if (newPasswordInput) newPasswordInput.value = '';
      if (resetModalAlert) resetModalAlert.classList.add('hidden');
      passwordModal.classList.remove('hidden');
      if (newPasswordInput) newPasswordInput.focus();
    }
  };

  /* ==========================================================================
     PASSWORD RESET MODAL HANDLERS
     ========================================================================== */

  function initPasswordModal() {
    function closeModal() {
      if (passwordModal) passwordModal.classList.add('hidden');
    }

    if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
    if (cancelResetBtn) cancelResetBtn.addEventListener('click', closeModal);
    if (passwordModal) {
      passwordModal.addEventListener('click', (e) => {
        if (e.target === passwordModal) closeModal();
      });
    }

    if (resetPasswordForm) {
      resetPasswordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const merchantId = resetMerchantIdInput ? resetMerchantIdInput.value : '';
        const newPassword = newPasswordInput ? newPasswordInput.value.trim() : '';

        if (!newPassword || newPassword.length < 4) {
          if (resetModalAlert) {
            resetModalAlert.textContent = 'Password must be at least 4 characters.';
            resetModalAlert.className = 'alert error';
            resetModalAlert.classList.remove('hidden');
          }
          return;
        }

        try {
          await apiClient.post('/api/admin/reset-password', { merchantId, newPassword });
          closeModal();
          uiComponents.showToast('Merchant password updated successfully!', 'success');
        } catch (err) {
          if (resetModalAlert) {
            resetModalAlert.textContent = 'Reset failed: ' + err.message;
            resetModalAlert.className = 'alert error';
            resetModalAlert.classList.remove('hidden');
          }
        }
      });
    }
  }

  /* ==========================================================================
     NAVBAR CONTROLS & WEBSOCKET
     ========================================================================== */

  function initNavAndWs() {
    if (adminLogoutBtn) {
      adminLogoutBtn.addEventListener('click', () => {
        localStorage.removeItem('slipte_admin_token');
        adminStore.setState({ isAuthenticated: false });
        uiComponents.showToast('Signed out from Admin Console', 'info');
        renderView('login');
      });
    }

    // Connect WebSocket with Badge
    wsManager = uiComponents.setupWebSocketWithBadge({
      path: '',
      badgeEl: adminConnBadge,
      onOpen: (ws) => {
        ws.send(JSON.stringify({ type: 'admin_init' }));
      },
      onMessage: () => {
        // When any broadcast event arrives, refresh dashboard data
        if (currentViewName === 'dashboard') {
          loadDashboardData();
        }
      }
    });
  }

  /* ==========================================================================
     APPLICATION INITIALIZATION
     ========================================================================== */

  function init() {
    initNavAndWs();
    initPasswordModal();

    const savedToken = localStorage.getItem('slipte_admin_token');
    if (savedToken) {
      adminStore.setState({ isAuthenticated: true });
      renderView('dashboard');
    } else {
      renderView('login');
    }
  }

  document.addEventListener('DOMContentLoaded', init);

})(window, document);
