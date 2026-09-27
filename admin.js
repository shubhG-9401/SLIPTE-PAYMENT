// Admin Portal Controller
let adminSession = null;
let pollInterval = null;

function formatCurrency(amt) {
  return '₹' + Number(amt || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// DOM Elements
const adminLoginSection = document.getElementById('adminLoginSection');
const adminDashboardSection = document.getElementById('adminDashboardSection');
const adminNavUser = document.getElementById('adminNavUser');
const adminLoginForm = document.getElementById('adminLoginForm');
const adminLoginAlert = document.getElementById('adminLoginAlert');
const adminLogoutBtn = document.getElementById('adminLogoutBtn');

// Modal Elements
const passwordModal = document.getElementById('passwordModal');
const resetPasswordForm = document.getElementById('resetPasswordForm');
const resetMerchantId = document.getElementById('resetMerchantId');
const resetMerchantPhone = document.getElementById('resetMerchantPhone');
const newPasswordInput = document.getElementById('newPassword');
const closeModalBtn = document.getElementById('closeModalBtn');
const cancelResetBtn = document.getElementById('cancelResetBtn');

// Refresh Buttons
const refreshMerchantsBtn = document.getElementById('refreshMerchantsBtn');
const refreshTxnsBtn = document.getElementById('refreshTxnsBtn');

document.addEventListener('DOMContentLoaded', () => {
  setupAdminAuth();
  setupModal();
  setupAdminSettingsModal();
  checkAdminSession();
});

function setupAdminAuth() {
  const clearFakeDataBtn = document.getElementById('clearFakeDataBtn');
  if (clearFakeDataBtn) {
    clearFakeDataBtn.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to remove all fake merchants and reset test transactions? The Demo merchant (MC-99) will be preserved cleanly.')) return;
      try {
        const res = await fetch('/api/admin/clear-fake-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keepDemo: true })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to clear fake data');
        alert('✓ All fake merchants and test transactions cleared successfully!');
        loadAdminStats();
        loadMerchants();
        loadGlobalTransactions();
      } catch (err) {
        alert('Error clearing data: ' + err.message);
      }
    });
  }
  adminLoginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    adminLoginAlert.classList.add('hidden');

    const username = document.getElementById('adminUsername').value.trim();
    const password = document.getElementById('adminPassword').value;

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Admin authentication failed');

      onAdminLoginSuccess(data.admin);
    } catch (err) {
      adminLoginAlert.textContent = err.message;
      adminLoginAlert.className = 'alert error';
      adminLoginAlert.classList.remove('hidden');
    }
  });

  adminLogoutBtn.addEventListener('click', () => {
    sessionStorage.removeItem('admin_session');
    clearInterval(pollInterval);
    adminSession = null;
    adminNavUser.classList.add('hidden');
    adminDashboardSection.classList.add('hidden');
    adminLoginSection.classList.remove('hidden');
  });

  refreshMerchantsBtn.addEventListener('click', () => {
    loadAdminStats();
    loadMerchants();
  });

  refreshTxnsBtn.addEventListener('click', () => {
    loadGlobalTransactions();
  });
}

function checkAdminSession() {
  const saved = sessionStorage.getItem('admin_session');
  if (saved) {
    try {
      const admin = JSON.parse(saved);
      onAdminLoginSuccess(admin);
    } catch (e) {
      sessionStorage.removeItem('admin_session');
    }
  }
}

function onAdminLoginSuccess(admin) {
  adminSession = admin;
  sessionStorage.setItem('admin_session', JSON.stringify(admin));

  adminLoginSection.classList.add('hidden');
  adminDashboardSection.classList.remove('hidden');
  adminNavUser.classList.remove('hidden');
  const loggedNameEl = document.getElementById('adminLoggedName');
  if (loggedNameEl) loggedNameEl.textContent = admin.username || 'admin';
  if (window.syncCurrentUsername) window.syncCurrentUsername();

  loadAdminStats();
  loadMerchants();
  loadGlobalTransactions();

  // Periodic poll every 6 seconds for live monitoring
  clearInterval(pollInterval);
  pollInterval = setInterval(() => {
    if (adminSession) {
      loadAdminStats();
      loadMerchants();
      loadGlobalTransactions();
    }
  }, 6000);
}

// KPI Stats
async function loadAdminStats() {
  try {
    const res = await fetch('/api/admin/stats');
    const data = await res.json();
    if (data.success && data.stats) {
      const s = data.stats;
      document.getElementById('kpiTotalMerchants').textContent = s.totalMerchants;
      document.getElementById('kpiActiveMerchants').textContent = s.activeMerchants;
      document.getElementById('kpiBlockedMerchants').textContent = s.blockedMerchants;
      document.getElementById('kpiTotalGmv').textContent = formatCurrency(s.totalGmv);
    }
  } catch (e) {
    console.error('Failed to load admin stats:', e);
  }
}

// Merchant List & Actions
async function loadMerchants() {
  try {
    const res = await fetch('/api/admin/merchants');
    const data = await res.json();
    if (data.success && data.merchants) {
      renderMerchantsTable(data.merchants);
    }
  } catch (e) {
    console.error('Failed to load merchants:', e);
  }
}

function renderMerchantsTable(merchants) {
  const tbody = document.getElementById('merchantsTableBody');
  if (!merchants.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center">No merchants registered yet.</td></tr>';
    return;
  }

  tbody.innerHTML = merchants.map(m => {
    const isBlocked = m.status === 'blocked';
    const code = m.merchant_code || (m.user_codes && m.user_codes[0]) || 'MC-99';
    let slotCountText = '0/2';
    if (m.slots && typeof m.slots.connectedCount === 'number') {
      slotCountText = `${m.slots.connectedCount}/2`;
    } else if (Array.isArray(m.slots)) {
      const active = m.slots.reduce((sum, s) => sum + (s.activeUsers || (s.connected ? 1 : 0)), 0);
      slotCountText = `${active}/2`;
    }

    return `
      <tr>
        <td>
          <strong>${m.phone}</strong>
          ${m.is_demo ? '<span class="status-badge" style="background:#fef3c7;color:#b45309;margin-left:4px;">Demo</span>' : ''}<br>
          <small style="color: #64748b;">Joined: ${new Date(m.created_at).toLocaleDateString()}</small>
        </td>
        <td><code>${m.upi_id}</code></td>
        <td><span class="status-badge" style="background:#002970;color:#fff;">Paytm (Live)</span></td>
        <td><strong style="color:#0284c7;font-family:monospace;font-size:1rem;">${code}</strong></td>
        <td><span class="status-badge" style="background:#e0f2fe;color:#0369a1;font-weight:800;">${slotCountText}</span></td>
        <td>
          <strong>${formatCurrency(m.revenue || 0)}</strong><br>
          <small style="color: #64748b;">${m.transactionCount || 0} Txns</small>
        </td>
        <td>
          <span class="status-badge ${m.status}">${m.status}</span>
        </td>
        <td>
          <div class="table-actions">
            ${isBlocked 
              ? `<button class="btn btn-sm btn-success" onclick="toggleMerchantStatus('${m.id}', 'active')">Approve / Unblock</button>` 
              : `<button class="btn btn-sm btn-danger" onclick="toggleMerchantStatus('${m.id}', 'blocked')">Block</button>`
            }
            <button class="btn btn-sm btn-outline" onclick="openResetPasswordModal('${m.id}', '${m.phone}')">Reset Password</button>
            <button class="btn btn-sm btn-danger-sm" onclick="deleteMerchant('${m.id}', '${m.phone}')" title="Delete merchant and all their data">🗑️ Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Block / Unblock Merchant
window.toggleMerchantStatus = async function(merchantId, newStatus) {
  const actionText = newStatus === 'blocked' ? 'BLOCK' : 'APPROVE / UNBLOCK';
  if (!confirm(`Are you sure you want to ${actionText} this merchant?`)) return;

  try {
    const res = await fetch(`/api/admin/merchants/${merchantId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update status');

    loadAdminStats();
    loadMerchants();
  } catch (err) {
    alert('Error updating merchant status: ' + err.message);
  }
};

// Password Reset Modal
function setupModal() {
  closeModalBtn.addEventListener('click', () => passwordModal.classList.add('hidden'));
  cancelResetBtn.addEventListener('click', () => passwordModal.classList.add('hidden'));

  resetPasswordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = resetMerchantId.value;
    const newPassword = newPasswordInput.value;

    try {
      const res = await fetch(`/api/admin/merchants/${id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reset password');

      alert('Password reset successfully for merchant!');
      passwordModal.classList.add('hidden');
      newPasswordInput.value = '';
    } catch (err) {
      alert('Password reset error: ' + err.message);
    }
  });
}

window.openResetPasswordModal = function(id, phone) {
  resetMerchantId.value = id;
  resetMerchantPhone.textContent = phone;
  newPasswordInput.value = '';
  passwordModal.classList.remove('hidden');
};

// Global Transactions Feed
async function loadGlobalTransactions() {
  try {
    const res = await fetch('/api/admin/transactions');
    const data = await res.json();
    if (data.success && data.transactions) {
      renderGlobalTransactionsTable(data.transactions);
    }
  } catch (e) {
    console.error('Failed to load global transactions:', e);
  }
}

function renderGlobalTransactionsTable(txns) {
  const tbody = document.getElementById('adminTxnsTableBody');
  if (!txns.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center">No transactions recorded across the network.</td></tr>';
    return;
  }

  tbody.innerHTML = txns.map(t => {
    const time = new Date(t.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const date = new Date(t.created_at).toLocaleDateString();

    return `
      <tr>
        <td><code>${t.id.slice(-8)}</code></td>
        <td>${date} ${time}</td>
        <td><strong>${t.merchant_phone || 'Unknown'}</strong></td>
        <td><code>${t.merchant_upi_id}</code></td>
        <td><strong>${t.user_code}</strong></td>
        <td><strong>${formatCurrency(t.total_amount)}</strong></td>
        <td>${t.split_count > 1 ? `<span class="slot-tag" style="background:#e0f2fe;color:#0284c7;">${t.split_count} Parts (≤1999)</span>` : '1 Part'}</td>
        <td><span class="status-badge ${t.status}">${t.status}</span></td>
      </tr>
    `;
  }).join('');
}

// Delete Individual Merchant
window.deleteMerchant = async function(merchantId, phone) {
  if (!confirm(`Are you sure you want to permanently delete merchant ${phone}? All their transactions will also be deleted.`)) return;

  try {
    const res = await fetch(`/api/admin/merchants/${merchantId}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete merchant');
    loadAdminStats();
    loadMerchants();
    loadGlobalTransactions();
  } catch (err) {
    alert('Error deleting merchant: ' + err.message);
  }
};

// Admin Settings Modal & Inline Form: Change Username & Password
function setupAdminSettingsModal() {
  const modal = document.getElementById('adminSettingsModal');
  const openBtn = document.getElementById('adminSettingsBtn');
  const closeBtn = document.getElementById('closeAdminSettingsBtn');
  const cancelBtn = document.getElementById('cancelAdminSettingsBtn');
  const form = document.getElementById('adminSettingsForm');
  const alertEl = document.getElementById('adminSettingsAlert');
  const currentUsernameInput = document.getElementById('adminCurrentUsername');
  const newUsernameInput = document.getElementById('adminNewUsername');
  const currentPasswordInput = document.getElementById('adminCurrentPassword');
  const newPasswordInput = document.getElementById('adminNewPassword');
  const confirmPasswordInput = document.getElementById('adminConfirmPassword');

  // Inline dashboard form elements
  const inlineForm = document.getElementById('adminSettingsInlineForm');
  const inlineAlert = document.getElementById('adminInlineAlert');
  const inlineCurrentUsername = document.getElementById('adminInlineCurrentUsername');
  const inlineNewUsername = document.getElementById('adminInlineNewUsername');
  const inlineNewPassword = document.getElementById('adminInlineNewPassword');
  const inlineConfirmPassword = document.getElementById('adminInlineConfirmPassword');

  window.syncCurrentUsername = function() {
    const uname = (adminSession && adminSession.username) || 'admin';
    if (currentUsernameInput) currentUsernameInput.value = uname;
    if (inlineCurrentUsername) inlineCurrentUsername.value = uname;
    if (newUsernameInput) newUsernameInput.placeholder = `Current: ${uname}`;
    if (inlineNewUsername) inlineNewUsername.placeholder = `Current: ${uname}`;
    const nameEl = document.getElementById('adminLoggedName');
    if (nameEl) nameEl.textContent = uname;
  };

  syncCurrentUsername();

  function openModal() {
    alertEl.classList.add('hidden');
    form.reset();
    syncCurrentUsername();
    modal.classList.remove('hidden');
    newUsernameInput.focus();
  }

  function closeModal() {
    modal.classList.add('hidden');
    form.reset();
    alertEl.classList.add('hidden');
  }

  if (openBtn) openBtn.addEventListener('click', openModal);
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

  // Close modal when clicking backdrop
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }

  // Modal Form Submission
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alertEl.classList.add('hidden');

    const currentPassword = currentPasswordInput.value;
    const newUsername = newUsernameInput.value.trim();
    const newPassword = newPasswordInput.value;
    const confirmPassword = confirmPasswordInput.value;

    if (newPassword && newPassword.length < 4) {
      alertEl.textContent = 'New password must be at least 4 characters long.';
      alertEl.className = 'alert error';
      alertEl.classList.remove('hidden');
      return;
    }

    if (newPassword && newPassword !== confirmPassword) {
      alertEl.textContent = 'New password and confirm password do not match.';
      alertEl.className = 'alert error';
      alertEl.classList.remove('hidden');
      return;
    }

    if (!newUsername && !newPassword) {
      alertEl.textContent = 'Please enter a new username or new password to update.';
      alertEl.className = 'alert error';
      alertEl.classList.remove('hidden');
      return;
    }

    try {
      const adminId = (adminSession && adminSession.id) || 'admin_1';
      const res = await fetch('/api/admin/update-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminId,
          currentPassword: currentPassword || undefined,
          newUsername: newUsername || undefined,
          newPassword: newPassword || undefined
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update admin credentials');

      // Update active session
      if (adminSession) {
        adminSession.username = data.admin.username;
        sessionStorage.setItem('admin_session', JSON.stringify(adminSession));
      }
      syncCurrentUsername();

      alertEl.textContent = '✓ Admin credentials updated successfully!';
      alertEl.className = 'alert success';
      alertEl.style.cssText = 'background:#dcfce7;color:#15803d;border:1px solid #bbf7d0;';
      alertEl.classList.remove('hidden');

      setTimeout(() => {
        closeModal();
      }, 1200);
    } catch (err) {
      alertEl.textContent = err.message;
      alertEl.className = 'alert error';
      alertEl.style.cssText = '';
      alertEl.classList.remove('hidden');
    }
  });

  // Inline Form Submission (Directly on Dashboard)
  if (inlineForm) {
    inlineForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      inlineAlert.classList.add('hidden');

      const newUsername = inlineNewUsername.value.trim();
      const newPassword = inlineNewPassword.value;
      const confirmPassword = inlineConfirmPassword.value;

      if (newPassword && newPassword.length < 4) {
        inlineAlert.textContent = 'New password must be at least 4 characters long.';
        inlineAlert.className = 'alert error';
        inlineAlert.classList.remove('hidden');
        return;
      }

      if (newPassword && newPassword !== confirmPassword) {
        inlineAlert.textContent = 'New password and confirm password do not match.';
        inlineAlert.className = 'alert error';
        inlineAlert.classList.remove('hidden');
        return;
      }

      if (!newUsername && !newPassword) {
        inlineAlert.textContent = 'Please specify a new username or new password to update.';
        inlineAlert.className = 'alert error';
        inlineAlert.classList.remove('hidden');
        return;
      }

      try {
        const adminId = (adminSession && adminSession.id) || 'admin_1';
        const res = await fetch('/api/admin/update-credentials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            adminId,
            newUsername: newUsername || undefined,
            newPassword: newPassword || undefined
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update credentials');

        if (adminSession) {
          adminSession.username = data.admin.username;
          sessionStorage.setItem('admin_session', JSON.stringify(adminSession));
        }
        syncCurrentUsername();
        inlineNewUsername.value = '';
        inlineNewPassword.value = '';
        inlineConfirmPassword.value = '';

        inlineAlert.textContent = '✓ Admin credentials updated successfully! Logged in as: ' + data.admin.username;
        inlineAlert.className = 'alert success';
        inlineAlert.style.cssText = 'background:#dcfce7;color:#15803d;border:1px solid #bbf7d0;';
        inlineAlert.classList.remove('hidden');
      } catch (err) {
        inlineAlert.textContent = err.message;
        inlineAlert.className = 'alert error';
        inlineAlert.style.cssText = '';
        inlineAlert.classList.remove('hidden');
      }
    });
  }
}
