// Merchant Portal Controller
let currentMerchant = null;
let ws = null;
let activeTxn = null;
let timerInterval = null;

// Audio alerts
function playSound(type) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (type === 'beep') {
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } else if (type === 'success') {
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1); // E5
      osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.2); // G5
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    }
  } catch (e) {
    // AudioContext blocked until user interacts
  }
}

// Helpers
function formatCurrency(amt) {
  return '₹' + Number(amt || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function calculateSplits(amount) {
  const max = 1999;
  const num = Math.round(Number(amount) * 100) / 100;
  if (num <= max) return [num];
  const parts = [];
  let remaining = num;
  while (remaining > 0) {
    if (remaining > max) {
      parts.push(max);
      remaining = Math.round((remaining - max) * 100) / 100;
    } else {
      parts.push(remaining);
      remaining = 0;
    }
  }
  return parts;
}

// DOM Elements
const authSection = document.getElementById('authSection');
const dashboardSection = document.getElementById('dashboardSection');
const navUserSection = document.getElementById('navUserSection');
const navMerchantPhone = document.getElementById('navMerchantPhone');
const logoutBtn = document.getElementById('logoutBtn');

const tabLogin = document.getElementById('tabLogin');
const tabRegister = document.getElementById('tabRegister');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const loginAlert = document.getElementById('loginAlert');
const regAlert = document.getElementById('regAlert');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupAuth();
  setupDashboardControls();
  checkExistingSession();
});

function setupTabs() {
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

function setupAuth() {
  // Demo Mode Instant Sandbox Handlers
  const tryDemoBtn = document.getElementById('tryDemoBtn');
  const tryDemoNavBtn = document.getElementById('tryDemoNavBtn');

  async function handleTryDemo() {
    try {
      const res = await fetch('/api/merchant/demo');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to start demo session');
      onLoginSuccess(data.merchant);
    } catch (err) {
      alert('Error activating demo mode: ' + err.message);
    }
  }

  if (tryDemoBtn) tryDemoBtn.addEventListener('click', handleTryDemo);
  if (tryDemoNavBtn) tryDemoNavBtn.addEventListener('click', handleTryDemo);

  // Autofill Demo Credentials
  const fillDemoCredsBtn = document.getElementById('fillDemoCredsBtn');
  if (fillDemoCredsBtn) {
    fillDemoCredsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const phoneInput = document.getElementById('loginPhone');
      const passInput = document.getElementById('loginPassword');
      if (phoneInput) phoneInput.value = '9999999999';
      if (passInput) passInput.value = 'demo123';
      loginAlert.textContent = '✓ Demo credentials filled: Phone 9999999999, Password demo123. Click "Sign In to Dashboard" below.';
      loginAlert.className = 'alert success';
      loginAlert.classList.remove('hidden');
      const submitBtn = document.getElementById('loginSubmitBtn');
      if (submitBtn) submitBtn.focus();
    });
  }

  // Login Submit
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginAlert.classList.add('hidden');
    const rawPhone = document.getElementById('loginPhone').value.trim();
    const phone = rawPhone.replace(/\D/g, '').slice(-10);
    let password = document.getElementById('loginPassword').value;

    if (!phone || phone.length !== 10) {
      loginAlert.textContent = '⚠️ Please enter a valid 10-digit mobile number.';
      loginAlert.className = 'alert error';
      loginAlert.classList.remove('hidden');
      document.getElementById('loginPhone').focus();
      return;
    }

    // Friendly auto-fill if user types demo phone but leaves password empty
    if (phone === '9999999999' && !password) {
      password = 'demo123';
      document.getElementById('loginPassword').value = 'demo123';
    }

    if (!password) {
      loginAlert.textContent = '⚠️ Please enter your password.';
      loginAlert.className = 'alert error';
      loginAlert.classList.remove('hidden');
      document.getElementById('loginPassword').focus();
      return;
    }

    const submitBtn = document.getElementById('loginSubmitBtn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Signing in...';
    }

    try {
      const res = await fetch('/api/merchant/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');

      onLoginSuccess(data.merchant);
    } catch (err) {
      loginAlert.textContent = '❌ ' + err.message;
      loginAlert.className = 'alert error';
      loginAlert.classList.remove('hidden');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In to Dashboard →';
      }
    }
  });

  // Registration Inputs & Sync
  const regPhoneInput = document.getElementById('regPhone');
  const regUpiInput = document.getElementById('regUpi');
  const regPasswordInput = document.getElementById('regPassword');
  const rzpPhoneHidden = document.getElementById('rzp_phone');
  const rzpUpiHidden = document.getElementById('rzp_upi');
  const rzpPasswordHidden = document.getElementById('rzp_password');

  let lastAutoUpiPhone = '';
  function syncRegDetails() {
    const rawPhone = regPhoneInput.value.trim();
    const phone = rawPhone.replace(/\D/g, '').slice(-10);
    const upi_id = regUpiInput.value.trim();
    const password = regPasswordInput.value;

    // Auto-suggest UPI ID when phone changes only if field is empty
    if (phone && !upi_id) {
      regUpiInput.value = `${phone}@paytm`;
    }

    if (rzpPhoneHidden) rzpPhoneHidden.value = phone;
    if (rzpUpiHidden) rzpUpiHidden.value = regUpiInput.value.trim();
    if (rzpPasswordHidden) rzpPasswordHidden.value = password;

    localStorage.setItem('pending_merchant_reg', JSON.stringify({
      phone,
      upi_id: regUpiInput.value.trim(),
      password,
      provider: 'paytm'
    }));
  }

  regPhoneInput.addEventListener('input', syncRegDetails);
  regUpiInput.addEventListener('input', syncRegDetails);
  regPasswordInput.addEventListener('input', syncRegDetails);

  // Restore pending registration if available
  const savedPending = localStorage.getItem('pending_merchant_reg');
  if (savedPending) {
    try {
      const p = JSON.parse(savedPending);
      if (p.phone) regPhoneInput.value = p.phone;
      if (p.upi_id) regUpiInput.value = p.upi_id;
      if (p.password) regPasswordInput.value = p.password;
      syncRegDetails();
    } catch (e) {}
  }

  // Intercept click on Razorpay button if fields are missing
  const rzpWrapper = document.getElementById('rzpWrapper');
  if (rzpWrapper) {
    rzpWrapper.addEventListener('click', () => {
      const phone = regPhoneInput.value.replace(/\D/g, '').slice(-10);
      const upi_id = regUpiInput.value.trim();
      const password = regPasswordInput.value;
      if (!phone || phone.length < 10 || !upi_id || !password) {
        regAlert.textContent = '⚠️ Please enter your 10-digit Mobile Number, UPI ID, and Password before paying via Razorpay.';
        regAlert.className = 'alert error';
        regAlert.classList.remove('hidden');
      } else {
        syncRegDetails();
      }
    }, true);
  }

  // Registration Submit Handler (Button click or Enter keypress)
  async function handleRegisterSubmit() {
    regAlert.classList.add('hidden');

    const rawPhone = regPhoneInput.value.trim();
    const phone = rawPhone.replace(/\D/g, '').slice(-10);
    const upi_id = regUpiInput.value.trim();
    const password = regPasswordInput.value;
    const provider = document.getElementById('gatewayDropdown') ? document.getElementById('gatewayDropdown').value : 'paytm';

    if (!phone || phone.length !== 10) {
      regAlert.textContent = '⚠️ Please enter a valid 10-digit mobile number.';
      regAlert.className = 'alert error';
      regAlert.classList.remove('hidden');
      regPhoneInput.focus();
      return;
    }

    if (!upi_id || !upi_id.includes('@')) {
      regAlert.textContent = '⚠️ Please enter a valid destination UPI ID (e.g. 9876543210@paytm).';
      regAlert.className = 'alert error';
      regAlert.classList.remove('hidden');
      regUpiInput.focus();
      return;
    }

    if (!password || password.length < 4) {
      regAlert.textContent = '⚠️ Password must be at least 4 characters long.';
      regAlert.className = 'alert error';
      regAlert.classList.remove('hidden');
      regPasswordInput.focus();
      return;
    }

    syncRegDetails();

    const regSubmitBtn = document.getElementById('regSubmitBtn');
    if (regSubmitBtn) {
      regSubmitBtn.disabled = true;
      regSubmitBtn.textContent = 'Creating Account & Activating...';
    }

    try {
      const res = await fetch('/api/merchant/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, password, provider, upi_id, fee_paid: true })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');

      regAlert.textContent = `🎉 Success! Assigned Unique Code ${data.merchant.merchant_code}. Loading your dashboard...`;
      regAlert.className = 'alert success';
      regAlert.classList.remove('hidden');

      localStorage.removeItem('pending_merchant_reg');
      setTimeout(() => {
        onLoginSuccess(data.merchant);
      }, 500);
    } catch (err) {
      regAlert.textContent = '❌ ' + err.message;
      regAlert.className = 'alert error';
      regAlert.classList.remove('hidden');
    } finally {
      if (regSubmitBtn) {
        regSubmitBtn.disabled = false;
        regSubmitBtn.textContent = '✨ Complete Free Registration & Activate →';
      }
    }
  }

  const regSubmitBtn = document.getElementById('regSubmitBtn');
  if (regSubmitBtn) regSubmitBtn.addEventListener('click', handleRegisterSubmit);

  [regPhoneInput, regUpiInput, regPasswordInput].forEach(inp => {
    if (inp) {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleRegisterSubmit();
        }
      });
    }
  });

  // Check URL parameters for automatic callback verification
  const urlParams = new URLSearchParams(window.location.search);
  const paymentVerified = urlParams.get('payment_verified');
  const callbackPaymentId = urlParams.get('razorpay_payment_id') || urlParams.get('payment_id');

  if (paymentVerified) {
    setTimeout(() => {
      alert('🎉 Merchant account registered & activated successfully!');
    }, 400);
  } else if (callbackPaymentId) {
    const saved = localStorage.getItem('pending_merchant_reg');
    if (saved) {
      try {
        const { phone, upi_id, password } = JSON.parse(saved);
        if (phone && upi_id) {
          fetch('/api/merchant/verify-razorpay', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              razorpay_payment_id: callbackPaymentId,
              phone,
              upi_id,
              password,
              provider: 'paytm'
            })
          })
          .then(r => r.json())
          .then(d => {
            if (d.success && d.merchant) {
              alert('🎉 Automatic Payment Verified from Razorpay!');
              localStorage.removeItem('pending_merchant_reg');
              onLoginSuccess(d.merchant);
            }
          });
        }
      } catch (e) {}
    }
  }

  // Listen to Razorpay postMessage from iframe
  window.addEventListener('message', async (event) => {
    if (event.data && typeof event.data === 'object') {
      const pid = event.data.razorpay_payment_id || event.data.payment_id;
      if (pid) {
        const saved = localStorage.getItem('pending_merchant_reg');
        if (saved) {
          const { phone, upi_id, password } = JSON.parse(saved);
          if (phone && upi_id) {
            const res = await fetch('/api/merchant/verify-razorpay', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_payment_id: pid,
                phone,
                upi_id,
                password,
                provider: 'paytm'
              })
            });
            const d = await res.json();
            if (d.success && d.merchant) {
              alert('🎉 Razorpay Payment Verified Automatically!');
              localStorage.removeItem('pending_merchant_reg');
              onLoginSuccess(d.merchant);
            }
          }
        }
      }
    }
  });

  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('merchant_session');
    if (ws) ws.close();
    clearInterval(timerInterval);
    currentMerchant = null;
    activeTxn = null;
    navUserSection.classList.add('hidden');
    dashboardSection.classList.add('hidden');
    authSection.classList.remove('hidden');
  });
}

function checkExistingSession() {
  const saved = localStorage.getItem('merchant_session');
  if (saved) {
    try {
      const m = JSON.parse(saved);
      fetchMerchantProfile(m.id);
    } catch (e) {
      localStorage.removeItem('merchant_session');
    }
  }
}

async function fetchMerchantProfile(id) {
  try {
    const res = await fetch('/api/merchant/me/' + id);
    const data = await res.json();
    if (res.ok && data.success) {
      onLoginSuccess(data.merchant);
    } else {
      localStorage.removeItem('merchant_session');
    }
  } catch (e) {
    console.error('Session verify error:', e);
  }
}

function onLoginSuccess(merchant) {
  currentMerchant = merchant;
  localStorage.setItem('merchant_session', JSON.stringify(merchant));

  // Switch UI
  authSection.classList.add('hidden');
  dashboardSection.classList.remove('hidden');
  navUserSection.classList.remove('hidden');

  const isDemo = merchant.is_demo || merchant.merchant_code === 'MC-99';
  navMerchantPhone.textContent = merchant.phone + (isDemo ? ' [Demo]' : '');
  document.getElementById('dashMerchantPhone').textContent = merchant.phone;
  document.getElementById('dashMerchantUpi').textContent = merchant.upi_id || 'paytm.s1m66cw@pty';
  const destUpiInput = document.getElementById('merchantDestinationUpi');
  if (destUpiInput) {
    destUpiInput.value = merchant.upi_id || 'paytm.s1m66cw@pty';
  }

  const code = merchant.merchant_code || (merchant.user_codes && merchant.user_codes[0]) || 'MC-99';
  const codeEl = document.getElementById('dashMerchantCode');
  if (codeEl) codeEl.textContent = code;

  const openTerminalLink = document.getElementById('openTerminalLink');
  if (openTerminalLink) {
    openTerminalLink.href = `/user.html?code=${code}`;
  }

  renderSlots(merchant.slots || [], merchant.slotInfo);
  startMerchantPollingBackup();
  connectWebSocket();
}

let merchantPollInterval = null;
function startMerchantPollingBackup() {
  if (merchantPollInterval) clearInterval(merchantPollInterval);
  syncMerchantState();
  merchantPollInterval = setInterval(() => {
    if (currentMerchant) {
      syncMerchantState();
    }
  }, 1200);
}

async function syncMerchantState() {
  if (!currentMerchant) return;
  try {
    const res = await fetch(`/api/merchant/sync/${currentMerchant.id}`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.success) return;

    // 1. Update Slots (Slot 1 and Slot 2 indicators)
    if (data.slots || data.slotInfo) {
      renderSlots(data.slots || [], data.slotInfo);
    }

    // 2. Update Revenue & Transaction Counts
    if (data.stats) {
      const s = data.stats;
      document.getElementById('statTotalRevenue').textContent = formatCurrency(s.totalRevenue);
      document.getElementById('statTodayRevenue').textContent = formatCurrency(s.todayRevenue);
      document.getElementById('statApprovedCount').textContent = s.approvedCount;
      document.getElementById('statDeniedCount').textContent = s.deniedCount;
    }

    // 3. Update Payment History Table
    if (data.transactions) {
      renderTransactionsTable(data.transactions);
    }

    // 4. Update Pending Approvals Queue & UTR
    syncActivePaymentFromState(data.activePayment);
  } catch (e) {
    console.warn('Sync error:', e);
  }
}

function syncActivePaymentFromState(ap) {
  if (!ap) {
    if (activeTxn && activeTxn.status !== 'approved' && activeTxn.status !== 'denied') {
      activeTxn = null;
      document.getElementById('noActiveTxnMsg').classList.remove('hidden');
      document.getElementById('activeTxnDetails').classList.add('hidden');
      document.getElementById('activeTimerBadge').classList.add('hidden');
      clearInterval(timerInterval);
    }
    return;
  }

  const isNewTxn = !activeTxn || activeTxn.id !== ap.id;
  const isNewPart = activeTxn && activeTxn.current_part_index !== ap.current_part_index;

  if (isNewTxn || isNewPart) {
    activeTxn = {
      id: ap.id,
      merchant_id: currentMerchant.id,
      user_code: ap.user_code,
      total_amount: ap.total_amount,
      split_count: ap.split_count,
      current_part_index: ap.current_part_index,
      chunks: [ap.currentChunk]
    };
    setActiveTransaction(activeTxn, ap.remainingSeconds || 120);
  }

  // If customer submitted payment / UTR
  if (ap.status === 'submitted' || (ap.currentChunk && ap.currentChunk.status === 'submitted')) {
    const banner = document.getElementById('activeStatusBanner');
    if (banner && !banner.classList.contains('submitted') && !banner.classList.contains('approved')) {
      playSound('beep');
      banner.className = 'active-status-banner submitted';
      document.getElementById('activeStatusText').textContent = '🔔 Customer submitted payment for verification.';
    }
    const utrVal = ap.utr || (ap.currentChunk && ap.currentChunk.utr);
    if (utrVal && utrVal !== 'Not provided') {
      document.getElementById('activeUtrBox').classList.remove('hidden');
      document.getElementById('activeUtrVal').textContent = utrVal;
    }
  }
}

// WebSocket Connection (with fallback backoff for Serverless/Vercel)
let wsRetries = 0;
function connectWebSocket() {
  if (!currentMerchant) return;
  if (wsRetries > 3) return; // Prevent infinite console errors on serverless platforms (Vercel)
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      wsRetries = 0;
      ws.send(JSON.stringify({
        type: 'merchant_init',
        merchantId: currentMerchant.id
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'merchant_ready' || msg.type === 'slot_updated') {
          renderSlots(msg.slots || [], msg.slotInfo);
        } else if (msg.type === 'user_submitted_payment') {
          playSound('beep');
          onUserSubmittedPayment(msg);
        } else if (msg.type === 'chunk_approved') {
          onChunkApproved(msg);
        } else if (msg.type === 'payment_decision_confirmed') {
          onDecisionConfirmed(msg.transaction);
        } else if (msg.type === 'payment_expired') {
          onPaymentExpired(msg.txnId);
        } else if (msg.type === 'merchant_blocked') {
          alert('⚠️ ' + msg.message);
          logoutBtn.click();
        }
      } catch (e) {
        console.error('WS Error:', e);
      }
    };

    ws.onerror = () => {
      wsRetries++;
    };

    ws.onclose = () => {
      wsRetries++;
      if (currentMerchant && wsRetries <= 3) {
        setTimeout(connectWebSocket, 5000);
      }
    };
  } catch (e) {
    wsRetries++;
  }
}

// Terminal & Slot Management (Max 2 distinct connected users)
function renderSlots(slots, slotInfo) {
  const code = currentMerchant.merchant_code || (currentMerchant.user_codes && currentMerchant.user_codes[0]) || 'MC-99';
  const codeEl = document.getElementById('dashMerchantCode');
  if (codeEl) codeEl.textContent = code;

  let activeCount = 0;
  if (slotInfo && typeof slotInfo.connectedCount === 'number') {
    activeCount = slotInfo.connectedCount;
  } else if (Array.isArray(slots) && slots.length > 0) {
    activeCount = slots.reduce((acc, s) => acc + (s.activeUsers || (s.connected ? 1 : 0)), 0);
  }

  const counter = document.getElementById('dashSlotsCounter');
  if (counter) {
    counter.textContent = `${activeCount}/2`;
    if (activeCount > 0) {
      counter.classList.add('active');
    } else {
      counter.classList.remove('active');
    }
  }

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
      txt2.textContent = 'Available';
    }
  }
}

// Setup Controls
function setupDashboardControls() {
  // Copy Unique Merchant Code Button
  const copyBtn = document.getElementById('copyMerchantCodeBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const code = (currentMerchant && currentMerchant.merchant_code) || document.getElementById('dashMerchantCode').textContent || 'MC-99';
      navigator.clipboard.writeText(code).then(() => {
        const orig = copyBtn.textContent;
        copyBtn.textContent = '✓ Copied!';
        setTimeout(() => copyBtn.textContent = orig, 1500);
      });
    });
  }

  // Destination UPI input, save button & Amount input live split preview
  const amountInput = document.getElementById('paymentAmount');
  const destUpiInput = document.getElementById('merchantDestinationUpi');
  const saveUpiBtn = document.getElementById('saveUpiBtn');
  const splitBox = document.getElementById('splitPreviewBox');
  const splitTitle = document.getElementById('splitPreviewTitle');
  const splitPills = document.getElementById('splitPillsContainer');
  const pushBtn = document.getElementById('pushPaymentBtn');

  function getActiveDestinationUpi() {
    return (destUpiInput && destUpiInput.value.trim()) || (currentMerchant && currentMerchant.upi_id) || 'paytm.s1m66cw@pty';
  }

  function updateSplitPreview() {
    const val = parseFloat(amountInput.value);
    const upiId = getActiveDestinationUpi();

    if (!val || val <= 0) {
      splitTitle.textContent = 'Auto-Splitting Preview';
      splitPills.innerHTML = '<span class="split-pill single">Enter an amount to see single or auto-split breakdown</span>';
      if (pushBtn) pushBtn.textContent = 'Push Payment Request →';
      return;
    }

    const parts = calculateSplits(val);

    if (parts.length === 1) {
      // Condition A (Amount <= ₹1999)
      const formattedAmt = parts[0].toFixed(2).replace(/\.00$/, '');
      const upiUri = `upi://pay?pa=${upiId}&am=${formattedAmt}&cu=INR&tn=Verified Merchant Account`;
      splitTitle.textContent = `Condition A (Amount ≤ ₹1999): Single Payload`;
      splitPills.innerHTML = `
        <div class="split-preview-item">
          <span class="split-pill single">Payload 1: ${formatCurrency(parts[0])}</span>
          <code class="upi-uri-string">${upiUri}</code>
        </div>
      `;
      if (pushBtn) pushBtn.textContent = `Push Payload 1 (${formatCurrency(parts[0])}) to User →`;
    } else {
      // Condition B (Amount > ₹1999)
      splitTitle.textContent = `Condition B (Amount > ₹1999): Auto-Split into ${parts.length} Sequential Payloads (Max ₹1999 each)`;
      splitPills.innerHTML = parts.map((amt, i) => {
        const formattedAmt = amt.toFixed(2).replace(/\.00$/, '');
        const chunkUri = `upi://pay?pa=${upiId}&am=${formattedAmt}&cu=INR&tn=Verified Merchant Account`;
        return `
          <div class="split-preview-item">
            <span class="split-pill chunk">Payload ${i + 1}: ${formatCurrency(amt)}</span>
            <code class="upi-uri-string">${chunkUri}</code>
            <span class="chunk-note">${i === 0 ? 'Pushed First (2-min timer)' : 'Queued sequentially after approval'}</span>
          </div>
        `;
      }).join('');
      if (pushBtn) pushBtn.textContent = `Push Payload 1 (${formatCurrency(parts[0])}) of ${parts.length} →`;
    }
  }

  amountInput.addEventListener('input', updateSplitPreview);
  if (destUpiInput) {
    destUpiInput.addEventListener('input', updateSplitPreview);
  }

  if (saveUpiBtn && destUpiInput) {
    saveUpiBtn.addEventListener('click', async () => {
      const upi = destUpiInput.value.trim();
      if (!upi || !upi.includes('@')) {
        return alert('Please enter a valid Destination UPI ID with @ (e.g. paytm.s1m66cw@pty)');
      }
      try {
        const res = await fetch('/api/merchant/update-upi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ merchantId: currentMerchant.id, upi_id: upi })
        });
        const data = await res.json();
        if (data.success) {
          currentMerchant.upi_id = upi;
          const dashUpiEl = document.getElementById('dashMerchantUpi');
          if (dashUpiEl) dashUpiEl.textContent = upi;
          saveUpiBtn.textContent = '✓ Saved!';
          setTimeout(() => saveUpiBtn.textContent = '💾 Save UPI', 2000);
          updateSplitPreview();
        } else {
          alert('Failed to update UPI: ' + (data.error || 'Unknown error'));
        }
      } catch (err) {
        alert('Network error saving UPI ID: ' + err.message);
      }
    });
  }

  // Payment Request Submit
  document.getElementById('paymentRequestForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = parseFloat(amountInput.value);
    if (!amount || amount <= 0) return alert('Please enter a valid payment amount');
    const enteredUpi = getActiveDestinationUpi();
    if (!enteredUpi || !enteredUpi.includes('@')) {
      return alert('Please enter a valid Destination UPI ID with @ (e.g. paytm.s1m66cw@pty)');
    }

    try {
      const code = (currentMerchant && currentMerchant.merchant_code) || 'MC-99';
      const res = await fetch('/api/merchant/payment-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantId: currentMerchant.id,
          targetSlotCode: code,
          amount,
          upi_id: enteredUpi
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create payment request');

      if (currentMerchant) {
        currentMerchant.upi_id = enteredUpi;
        const dashUpiEl = document.getElementById('dashMerchantUpi');
        if (dashUpiEl) dashUpiEl.textContent = enteredUpi;
      }

      setActiveTransaction(data.transaction, 120);
      playSound('beep');
    } catch (err) {
      alert('Error creating payment: ' + err.message);
    }
  });

  // Approve & Deny Buttons
  document.getElementById('approvePaymentBtn').addEventListener('click', () => sendPaymentDecision('approve'));
  document.getElementById('denyPaymentBtn').addEventListener('click', () => sendPaymentDecision('deny'));

  // Refresh Stats
  document.getElementById('refreshStatsBtn').addEventListener('click', () => {
    loadStats();
    loadTransactions();
  });
}

// Active Transaction & Sequential Chunk Controller
function setActiveTransaction(txn, remainingSeconds = 120) {
  activeTxn = txn;
  clearInterval(timerInterval);

  document.getElementById('noActiveTxnMsg').classList.add('hidden');
  const details = document.getElementById('activeTxnDetails');
  details.classList.remove('hidden');

  const currentIdx = (txn.current_part_index || 1) - 1;
  const currentChunk = (txn.chunks && txn.chunks[currentIdx]) || (txn.splits && txn.splits[currentIdx]) || { amount: txn.total_amount };

  document.getElementById('activeChunkTag').textContent = `Payload ${txn.current_part_index || 1} of ${txn.split_count || 1}`;
  document.getElementById('activeTotalTag').textContent = `Total: ${formatCurrency(txn.total_amount)}`;
  document.getElementById('activeAmountVal').textContent = formatCurrency(currentChunk.amount);
  document.getElementById('activeSplitSubtext').textContent = txn.split_count > 1 
    ? `Sequential Chunk ${txn.current_part_index || 1} of ${txn.split_count}`
    : `Single Payment Payload`;

  const banner = document.getElementById('activeStatusBanner');
  banner.className = 'active-status-banner';
  banner.style.background = '';
  banner.style.color = '';
  document.getElementById('activeStatusText').textContent = 'Waiting for customer to scan QR on terminal...';
  document.getElementById('activeUtrBox').classList.add('hidden');

  const hint = document.getElementById('controllerHint');
  if (hint) {
    if (txn.split_count > 1 && (txn.current_part_index || 1) < txn.split_count) {
      hint.textContent = `⚡ Approving will update sales stats (+${formatCurrency(currentChunk.amount)}) and automatically push Payload ${(txn.current_part_index || 1) + 1} to user.`;
    } else {
      hint.textContent = 'Verify incoming funds in your Paytm app before approving.';
    }
  }

  // Start 2-Minute Timer
  const timerBadge = document.getElementById('activeTimerBadge');
  timerBadge.classList.remove('hidden');
  let timeLeft = remainingSeconds;

  function updateTimer() {
    const mins = Math.floor(timeLeft / 60);
    const secs = timeLeft % 60;
    timerBadge.textContent = `⏱ ${mins}:${secs < 10 ? '0' : ''}${secs}`;
    if (timeLeft <= 30) {
      timerBadge.classList.add('urgent');
    } else {
      timerBadge.classList.remove('urgent');
    }

    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      timerBadge.textContent = '⏱ Expired';
      document.getElementById('activeStatusText').textContent = 'Payment expired after 120 seconds.';
    }
    timeLeft--;
  }

  updateTimer();
  timerInterval = setInterval(updateTimer, 1000);
}

function onUserSubmittedPayment(data) {
  if (activeTxn && activeTxn.id === data.txnId) {
    document.getElementById('activeStatusBanner').className = 'active-status-banner submitted';
    document.getElementById('activeStatusText').textContent = `🔔 Customer submitted payment for verification.`;
    
    if (data.utr && data.utr !== 'Not provided') {
      document.getElementById('activeUtrBox').classList.remove('hidden');
      document.getElementById('activeUtrVal').textContent = data.utr;
    }
  }
}

async function sendPaymentDecision(action) {
  if (!activeTxn) return;
  try {
    const res = await fetch('/api/merchant/payment-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchantId: currentMerchant.id,
        txnId: activeTxn.id,
        action
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Action failed');

    if (action === 'approve') {
      if (data.completed === false) {
        // Multi-split: chunk approved, next chunk pushed!
        playSound('beep');
        activeTxn = data.transaction;
        setActiveTransaction(data.transaction, 120);
        const banner = document.getElementById('activeStatusBanner');
        banner.className = 'active-status-banner approved';
        banner.style.background = '#e0f2fe';
        banner.style.color = '#0369a1';
        document.getElementById('activeStatusText').textContent = `✓ Previous chunk approved! Sales volume updated. Next chunk (Payload ${data.transaction.current_part_index}) is active.`;
        loadStats();
        loadTransactions();
      } else {
        onDecisionConfirmed(data.transaction);
      }
    } else {
      onDecisionConfirmed(data.transaction);
    }
  } catch (err) {
    alert('Decision error: ' + err.message);
  }
}

function onChunkApproved(data) {
  if (activeTxn && activeTxn.id === data.transaction.id) {
    activeTxn = data.transaction;
    setActiveTransaction(data.transaction, 120);
    loadStats();
    loadTransactions();
  }
}

function onDecisionConfirmed(txn) {
  clearInterval(timerInterval);
  document.getElementById('activeTimerBadge').classList.add('hidden');

  const banner = document.getElementById('activeStatusBanner');
  if (txn.status === 'approved') {
    playSound('success');
    banner.className = 'active-status-banner approved';
    banner.style.background = '#dcfce7';
    banner.style.color = '#15803d';
    document.getElementById('activeStatusText').textContent = `✓ Entire Payment Approved & Complete! ${formatCurrency(txn.total_amount)} recorded in Total Sales.`;
  } else {
    banner.className = 'active-status-banner denied';
    banner.style.background = '#fee2e2';
    banner.style.color = '#dc2626';
    document.getElementById('activeStatusText').textContent = `✕ Transaction Denied by Merchant.`;
  }

  loadStats();
  loadTransactions();

  setTimeout(() => {
    if (activeTxn && activeTxn.id === txn.id) {
      document.getElementById('activeTxnDetails').classList.add('hidden');
      document.getElementById('noActiveTxnMsg').classList.remove('hidden');
      activeTxn = null;
    }
  }, 4000);
}

function onPaymentExpired(txnId) {
  if (activeTxn && activeTxn.id === txnId) {
    clearInterval(timerInterval);
    document.getElementById('activeTimerBadge').textContent = '⏱ Expired';
    document.getElementById('activeStatusText').textContent = 'Payment expired after 2 minutes.';
    loadStats();
    loadTransactions();
  }
}

// Stats & History
async function loadStats() {
  if (!currentMerchant) return;
  try {
    const res = await fetch(`/api/merchant/stats/${currentMerchant.id}`);
    const data = await res.json();
    if (data.success && data.stats) {
      const s = data.stats;
      document.getElementById('statTotalRevenue').textContent = formatCurrency(s.totalRevenue);
      document.getElementById('statTodayRevenue').textContent = formatCurrency(s.todayRevenue);
      document.getElementById('statApprovedCount').textContent = s.approvedCount;
      document.getElementById('statDeniedCount').textContent = s.deniedCount;
      if (s.slots || s.slotInfo) {
        renderSlots(s.slots || [], s.slotInfo);
      }
    }
  } catch (e) {
    console.error('Stats error:', e);
  }
}

async function loadTransactions() {
  if (!currentMerchant) return;
  try {
    const res = await fetch(`/api/merchant/transactions/${currentMerchant.id}`);
    const data = await res.json();
    if (data.success && data.transactions) {
      renderTransactionsTable(data.transactions);
    }
  } catch (e) {
    console.error('Txns error:', e);
  }
}

function renderTransactionsTable(txns) {
  const tbody = document.getElementById('txnsTableBody');
  if (!txns.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">No transactions recorded yet.</td></tr>';
    return;
  }

  tbody.innerHTML = txns.map(t => {
    const time = new Date(t.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const date = new Date(t.created_at).toLocaleDateString();
    return `
      <tr>
        <td><code>${t.id.slice(-8)}</code></td>
        <td>${date} ${time}</td>
        <td><strong>${t.user_code}</strong></td>
        <td><strong>${formatCurrency(t.total_amount)}</strong></td>
        <td>${t.split_count > 1 ? `<span class="split-pill" style="font-size: 0.72rem;">${t.split_count} Parts (≤1999)</span>` : '1 Part'}</td>
        <td><span class="status-badge ${t.status}">${t.status}</span></td>
      </tr>
    `;
  }).join('');
}
