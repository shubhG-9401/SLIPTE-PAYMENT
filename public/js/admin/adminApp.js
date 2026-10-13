/**
 * @file adminApp.js
 * @description Platform Administration application controller, metrics display, directory audits, and governance tools.
 */

(function (window, document) {
  'use strict';

  const { adminStore, apiClient, appUtils } = window;

  // DOM Elements
  const adminAuthSection = document.getElementById('adminAuthSection');
  const adminDashboardSection = document.getElementById('adminDashboardSection');
  const navAdminUser = document.getElementById('navAdminUser');
  const adminLogoutBtn = document.getElementById('adminLogoutBtn');

  const adminLoginForm = document.getElementById('adminLoginForm');
  const adminUsername = document.getElementById('adminUsername');
  const adminPassword = document.getElementById('adminPassword');
  const adminLoginAlert = document.getElementById('adminLoginAlert');

  // Stats
  const statGmv = document.getElementById('statGmv');
  const statMerchants = document.getElementById('statMerchants');
  const statTxns = document.getElementById('statTxns');
  const statTerminals = document.getElementById('statTerminals');
  const adminRefreshBtn = document.getElementById('adminRefreshBtn');
  const clearDataBtn = document.getElementById('clearDataBtn');

  // Tables
  const merchantTableBody = document.getElementById('merchantTableBody');
  const auditTableBody = document.getElementById('auditTableBody');

  /* ==========================================================================
     AUTHENTICATION
     ========================================================================== */

  function initAuth() {
    if (adminLoginForm) {
      adminLoginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        adminLoginAlert.classList.add('hidden');

        try {
          const res = await apiClient.post('/api/admin/login', {
            username: adminUsername.value.trim(),
            password: adminPassword.value
          });

          localStorage.setItem('slipte_admin_token', res.token);
          handleAdminLoginSuccess();
        } catch (err) {
          adminLoginAlert.textContent = '❌ ' + err.message;
          adminLoginAlert.className = 'alert error';
          adminLoginAlert.classList.remove('hidden');
        }
      });
    }

    if (adminLogoutBtn) {
      adminLogoutBtn.addEventListener('click', () => {
        localStorage.removeItem('slipte_admin_token');
        adminStore.setState({ isAuthenticated: false });
        adminAuthSection.classList.remove('hidden');
        adminDashboardSection.classList.add('hidden');
        navAdminUser.classList.add('hidden');
      });
    }

    // Auto-login from saved session token
    if (localStorage.getItem('slipte_admin_token')) {
      handleAdminLoginSuccess();
    }
  }

  function handleAdminLoginSuccess() {
    adminStore.setState({ isAuthenticated: true });
    adminAuthSection.classList.add('hidden');
    adminDashboardSection.classList.remove('hidden');
    navAdminUser.classList.remove('hidden');

    loadAdminDashboardData();
  }

  /* ==========================================================================
     DATA LOADING & RENDERING
     ========================================================================== */

  async function loadAdminDashboardData() {
    try {
      const [statsRes, merchantsRes, txnsRes] = await Promise.all([
        apiClient.get('/api/admin/stats'),
        apiClient.get('/api/admin/merchants'),
        apiClient.get('/api/admin/transactions')
      ]);

      if (statsRes.success) renderStats(statsRes.stats);
      if (merchantsRes.success) renderMerchantsTable(merchantsRes.merchants);
      if (txnsRes.success) renderAuditTable(txnsRes.transactions);
    } catch (err) {
      console.warn('Admin data load error:', err);
    }
  }

  function renderStats(s) {
    if (statGmv) statGmv.textContent = appUtils.formatCurrency(s.totalGMV);
    if (statMerchants) statMerchants.textContent = `${s.activeMerchants} / ${s.totalMerchants}`;
    if (statTxns) statTxns.textContent = `${s.approvedTransactions} / ${s.totalTransactions}`;
    if (statTerminals) statTerminals.textContent = s.activeTerminalsCount;
  }

  function renderMerchantsTable(merchants) {
    if (!merchantTableBody) return;
    if (!merchants || merchants.length === 0) {
      merchantTableBody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No merchants registered yet.</td></tr>';
      return;
    }

    merchantTableBody.innerHTML = merchants.map(m => {
      const isBlocked = m.status === 'blocked';
      const statusPill = isBlocked
        ? '<span class="status-pill status-denied">BLOCKED</span>'
        : '<span class="status-pill status-approved">ACTIVE</span>';

      const actionBtn = isBlocked
        ? `<button class="btn btn-sm btn-outline" onclick="window.adminActions.toggleStatus('${m.id}', 'active')">✓ Unblock</button>`
        : `<button class="btn btn-sm btn-danger-soft" onclick="window.adminActions.toggleStatus('${m.id}', 'blocked')">🚫 Block</button>`;

      const resetBtn = `<button class="btn btn-sm btn-secondary" onclick="window.adminActions.resetPassword('${m.id}')">🔑 Reset Pass</button>`;

      const upiDisplay = Array.isArray(m.upi_ids) && m.upi_ids.length > 1
        ? `${m.upi_id} <small class="text-muted">(+${m.upi_ids.length - 1} more)</small>`
        : (m.upi_id || '-');

      return `
        <tr>
          <td><code>${m.merchant_code || '------'}</code></td>
          <td>${m.phone}</td>
          <td><span class="badge live">Paytm</span></td>
          <td><small>${upiDisplay}</small></td>
          <td>${statusPill}</td>
          <td><small>${appUtils.formatDate(m.created_at)}</small></td>
          <td>
            <div class="action-buttons-group">
              ${actionBtn}
              ${resetBtn}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderAuditTable(txns) {
    if (!auditTableBody) return;
    if (!txns || txns.length === 0) {
      auditTableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No transactions on platform.</td></tr>';
      return;
    }

    auditTableBody.innerHTML = txns.map(t => {
      const statusClass = t.status === 'approved' ? 'status-approved' : (t.status === 'denied' ? 'status-denied' : 'status-pending');
      const splits = t.split_count > 1 ? `${t.split_count} Chunks (≤ ₹1999)` : 'Single Payload';
      return `
        <tr>
          <td><code>${t.id.slice(0, 15)}...</code></td>
          <td><strong>${appUtils.formatCurrency(t.total_amount)}</strong></td>
          <td><code>${t.merchant_code || t.user_code}</code></td>
          <td><span class="badge ${splits === 'Single Payload' ? '' : 'live'}">${splits}</span></td>
          <td><span class="status-pill ${statusClass}">${t.status.toUpperCase()}</span></td>
          <td><small>${appUtils.formatDate(t.created_at)}</small></td>
        </tr>
      `;
    }).join('');
  }

  /* ==========================================================================
     ADMINISTRATIVE ACTIONS
     ========================================================================== */

  window.adminActions = {
    async toggleStatus(merchantId, newStatus) {
      if (!confirm(`Are you sure you want to mark this merchant as ${newStatus}?`)) return;
      try {
        await apiClient.post('/api/admin/merchant-status', { merchantId, status: newStatus });
        loadAdminDashboardData();
      } catch (err) {
        alert('Action failed: ' + err.message);
      }
    },

    async resetPassword(merchantId) {
      const newPassword = prompt('Enter new password for this merchant (min 4 characters):', 'pass123');
      if (!newPassword) return;
      try {
        await apiClient.post('/api/admin/reset-password', { merchantId, newPassword });
        alert('✓ Password updated successfully!');
      } catch (err) {
        alert('Password reset failed: ' + err.message);
      }
    }
  };

  function initControls() {
    if (adminRefreshBtn) {
      adminRefreshBtn.addEventListener('click', loadAdminDashboardData);
    }

    if (clearDataBtn) {
      clearDataBtn.addEventListener('click', async () => {
        if (!confirm('⚠️ Are you sure you want to clear non-demo test transactions and merchants? Demo account (999999) will be preserved.')) return;
        try {
          const res = await apiClient.post('/api/admin/clear-data', { keepDemo: true });
          alert(`✓ Cleaned! Remaining merchants: ${res.counts.merchantsCount}`);
          loadAdminDashboardData();
        } catch (err) {
          alert('Failed to clear data: ' + err.message);
        }
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    initAuth();
    initControls();
  });

})(window, document);
