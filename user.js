// User Payment Terminal Controller
let ws = null;
let currentCode = null;
let currentTxn = null;
let activeSplitIndex = 0;
let timerInterval = null;
let totalTimerSeconds = 120;
let remainingSeconds = 120;

// Audio Alerts
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

    if (type === 'chime') {
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1); // E5
      osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.2); // G5
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } else if (type === 'alert') {
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    }
  } catch (e) {
    // AudioContext blocked
  }
}

function formatCurrency(amt) {
  return '₹' + Number(amt || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// DOM Elements
const connectionStatusBadge = document.getElementById('connectionStatusBadge');
const pairingBox = document.getElementById('pairingBox');
const upiBox = document.getElementById('upiBox');
const pairingForm = document.getElementById('pairingForm');
const inputPairingCode = document.getElementById('inputPairingCode');
const pairingAlert = document.getElementById('pairingAlert');

const merchantInfoText = document.getElementById('merchantInfoText');
const waitingMerchantUpi = document.getElementById('waitingMerchantUpi');

// States inside UPI Box
const waitingState = document.getElementById('waitingState');
const paymentActiveState = document.getElementById('paymentActiveState');
const paymentSubmittedState = document.getElementById('paymentSubmittedState');
const paymentApprovedState = document.getElementById('paymentApprovedState');
const paymentDeniedState = document.getElementById('paymentDeniedState');
const paymentExpiredState = document.getElementById('paymentExpiredState');

// Payment Active Elements
const timerText = document.getElementById('timerText');
const timerProgressFill = document.getElementById('timerProgressFill');
const displayTotalAmount = document.getElementById('displayTotalAmount');
const splitNoticeBadge = document.getElementById('splitNoticeBadge');
const splitPartsNav = document.getElementById('splitPartsNav');
const splitButtonsContainer = document.getElementById('splitButtonsContainer');
const qrImage = document.getElementById('qrImage');
const qrLoading = document.getElementById('qrLoading');
const currentPartAmount = document.getElementById('currentPartAmount');
const upiIntentBtn = document.getElementById('upiIntentBtn');
const copyUpiLinkBtn = document.getElementById('copyUpiLinkBtn');
const iHavePaidBtn = document.getElementById('iHavePaidBtn');
const userUtrInput = document.getElementById('userUtrInput');

// Result Elements
const receiptAmount = document.getElementById('receiptAmount');
const resetTerminalBtn = document.getElementById('resetTerminalBtn');
const retryTerminalBtn = document.getElementById('retryTerminalBtn');
const expiredTerminalBtn = document.getElementById('expiredTerminalBtn');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupEventHandlers();

  // Check URL query parameters for ?code=XYZ or localStorage
  const params = new URLSearchParams(window.location.search);
  const codeParam = params.get('code') || localStorage.getItem('slipte_last_code');
  if (codeParam) {
    inputPairingCode.value = codeParam.toUpperCase();
    connectTerminal(codeParam.toUpperCase());
  }
});

function setupEventHandlers() {
  pairingForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = inputPairingCode.value.trim().toUpperCase();
    if (code) connectTerminal(code);
  });

  if (iHavePaidBtn) {
    iHavePaidBtn.addEventListener('click', () => {
      submitPaymentProof();
    });
  }

  if (copyUpiLinkBtn) {
    copyUpiLinkBtn.addEventListener('click', () => {
      if (!currentTxn || !currentTxn.splits) return;
      const split = currentTxn.splits[activeSplitIndex];
      if (split && split.upi_uri) {
        navigator.clipboard.writeText(split.upi_uri).then(() => {
          const orig = copyUpiLinkBtn.textContent;
          copyUpiLinkBtn.textContent = '✓ Copied!';
          setTimeout(() => copyUpiLinkBtn.textContent = orig, 1500);
        });
      }
    });
  }

  resetTerminalBtn.addEventListener('click', () => showState('waiting'));
  retryTerminalBtn.addEventListener('click', () => showState('waiting'));
  expiredTerminalBtn.addEventListener('click', () => showState('waiting'));
}

function showState(stateName) {
  waitingState.classList.add('hidden');
  paymentActiveState.classList.add('hidden');
  paymentSubmittedState.classList.add('hidden');
  paymentApprovedState.classList.add('hidden');
  paymentDeniedState.classList.add('hidden');
  paymentExpiredState.classList.add('hidden');

  if (stateName === 'waiting') waitingState.classList.remove('hidden');
  else if (stateName === 'active') paymentActiveState.classList.remove('hidden');
  else if (stateName === 'submitted') paymentSubmittedState.classList.remove('hidden');
  else if (stateName === 'approved') paymentApprovedState.classList.remove('hidden');
  else if (stateName === 'denied') paymentDeniedState.classList.remove('hidden');
  else if (stateName === 'expired') paymentExpiredState.classList.remove('hidden');
}

let userSessionId = sessionStorage.getItem('slipte_user_sess');
if (!userSessionId) {
  userSessionId = 'sess_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now().toString(36);
  sessionStorage.setItem('slipte_user_sess', userSessionId);
}

let pollInterval = null;
let isWsConnected = false;
let lastProcessedTxnState = null;

// // Connect Terminal via Code
async function connectTerminal(code) {
  pairingAlert.classList.add('hidden');

  try {
    const res = await fetch(`/api/user/terminal/${encodeURIComponent(code)}?sessionId=${encodeURIComponent(userSessionId)}`);
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error('Server starting up, please click Connect Terminal again in a moment.');
    }

    if (!res.ok || !data.valid) {
      throw new Error(data.error || 'Invalid pairing code');
    }

    currentCode = code;
    try { localStorage.setItem('slipte_last_code', code); } catch (e) {}

    // Immediately transition into the paired terminal screen!
    onTerminalConnected({
      code: code,
      merchantPhone: data.merchant.phone,
      merchantUpi: data.merchant.upi_id,
      slot: data.slot
    });

    // Start continuous polling heartbeat & state synchronization (rock-solid on Vercel)
    startHttpPolling(code, data.merchant);
    initWebSocket(code, data.merchant);
  } catch (err) {
    pairingAlert.textContent = err.message;
    pairingAlert.className = 'alert error';
    pairingAlert.classList.remove('hidden');
  }
}

// HTTP Polling fallback & Slot Heartbeat (Works 100% on Serverless/Vercel & Local)
function startHttpPolling(code, merchantInfo) {
  if (pollInterval) clearInterval(pollInterval);

  async function poll() {
    try {
      const res = await fetch(`/api/user/terminal/${encodeURIComponent(code)}?sessionId=${encodeURIComponent(userSessionId)}`);
      if (!res.ok) return;
      const data = await res.json();

      if (data.blocked) {
        alert('⚠️ ' + data.message);
        location.reload();
        return;
      }

      if (data.slot) {
        connectionStatusBadge.textContent = `Terminal Live (Slot ${data.slot})`;
        connectionStatusBadge.className = 'status-badge online';
      }

      if (data.activePayment) {
        const ap = data.activePayment;
        const txn = ap.transaction || ap;
        const stateKey = `${ap.id}_part_${ap.currentPart}_${ap.status}`;
        const isUIWaiting = paymentActiveState.classList.contains('hidden') && paymentSubmittedState.classList.contains('hidden');

        if (lastProcessedTxnState !== stateKey || isUIWaiting) {
          lastProcessedTxnState = stateKey;
          currentTxn = txn;

          if (ap.status === 'submitted') {
            showState('submitted');
          } else if (ap.status === 'pending') {
            if (ap.currentPart > 1) {
              playSound('chime');
            } else {
              playSound('alert');
            }
            onPaymentReceived(txn, ap.remainingSeconds || 120, ap.qrDataUrl);
          }
        } else if (ap.status === 'pending' && ap.qrDataUrl && (!qrImage.src || qrImage.src.endsWith('/'))) {
          qrImage.src = ap.qrDataUrl;
          qrLoading.classList.add('hidden');
        }
      } else {
        // No active pending payment
        if (data.lastTransaction && currentTxn && data.lastTransaction.id === currentTxn.id) {
          const stateKey = `${data.lastTransaction.id}_decision_${data.lastTransaction.status}`;
          if (lastProcessedTxnState !== stateKey) {
            lastProcessedTxnState = stateKey;
            if (data.lastTransaction.status === 'approved') {
              onPaymentDecision({ status: 'approved', transaction: data.lastTransaction });
            } else if (data.lastTransaction.status === 'denied') {
              onPaymentDecision({ status: 'denied', transaction: data.lastTransaction });
            }
          }
        } else if (!currentTxn) {
          showState('waiting');
          lastProcessedTxnState = null;
        }
      }
    } catch (e) {
      console.warn('HTTP Polling error:', e);
    }
  }

  poll();
  pollInterval = setInterval(poll, 1200);
}

let userWsRetries = 0;
function initWebSocket(code, merchantInfo) {
  if (userWsRetries > 3) return; // Prevent console spam on Vercel serverless
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      userWsRetries = 0;
      isWsConnected = true;
      ws.send(JSON.stringify({
        type: 'user_init',
        userCode: code
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'user_ready') {
          onTerminalConnected(msg);
        } else if (msg.type === 'user_error') {
          alert(msg.message);
          connectionStatusBadge.textContent = 'Disconnected';
          connectionStatusBadge.className = 'status-badge offline';
        } else if (msg.type === 'active_payment' || msg.type === 'payment_incoming') {
          playSound('alert');
          onPaymentReceived(msg.transaction, msg.remainingSeconds || 120);
        } else if (msg.type === 'chunk_approved_next') {
          onChunkApprovedNext(msg);
        } else if (msg.type === 'payment_decision') {
          onPaymentDecision(msg);
        } else if (msg.type === 'payment_expired') {
          onPaymentExpired();
        } else if (msg.type === 'merchant_blocked') {
          alert('⚠️ ' + msg.message);
          location.reload();
        }
      } catch (e) {
        console.error('WS parse error:', e);
      }
    };

    ws.onclose = () => {
      isWsConnected = false;
      userWsRetries++;
      if (currentCode && userWsRetries <= 3) {
        setTimeout(() => initWebSocket(currentCode, merchantInfo), 6000);
      }
    };

    ws.onerror = () => {
      isWsConnected = false;
      userWsRetries++;
    };
  } catch (err) {
    isWsConnected = false;
    userWsRetries++;
  }
}

function onTerminalConnected(msg) {
  const slotText = msg.slot ? ` (Slot ${msg.slot})` : '';
  connectionStatusBadge.textContent = `Terminal Live${slotText}`;
  connectionStatusBadge.className = 'status-badge online';

  pairingBox.classList.add('hidden');
  upiBox.classList.remove('hidden');

  merchantInfoText.textContent = `Merchant Connected (${msg.code || 'MC-99'})${slotText}`;
  if (msg.merchantUpi) waitingMerchantUpi.textContent = msg.merchantUpi;
  showState('waiting');
}

// Payment Flow with Sequential Chunk Rendering
function onPaymentReceived(txn, secs = 120, preloadedQrDataUrl = null) {
  currentTxn = txn;
  totalTimerSeconds = 120;
  remainingSeconds = secs;

  displayTotalAmount.textContent = Number(txn.total_amount).toFixed(2);
  receiptAmount.textContent = formatCurrency(txn.total_amount);

  const currentIdx = (txn.current_part_index || 1) - 1;
  const currentChunk = (txn.chunks && txn.chunks[currentIdx]) || (txn.splits && txn.splits[currentIdx]) || {
    amount: txn.total_amount,
    upi_uri: `upi://pay?pa=${(txn.merchant_upi_id || 'merchant@paytm').trim()}&am=${Number(txn.total_amount).toFixed(2).replace(/\.00$/, '')}&cu=INR&tn=Verified Merchant Account`
  };

  if (txn.split_count > 1) {
    splitNoticeBadge.classList.remove('hidden');
    splitNoticeBadge.textContent = `Payload ${txn.current_part_index || 1} of ${txn.split_count} (Auto-Split ≤ ₹1999)`;
  } else {
    splitNoticeBadge.classList.add('hidden');
  }

  currentPartAmount.textContent = `Pay ${formatCurrency(currentChunk.amount)}`;
  if (upiIntentBtn) upiIntentBtn.href = currentChunk.upi_uri;

  if (preloadedQrDataUrl) {
    qrImage.src = preloadedQrDataUrl;
    qrLoading.classList.add('hidden');
  } else {
    qrLoading.classList.remove('hidden');
    fetch(`/api/qr?text=${encodeURIComponent(currentChunk.upi_uri)}`)
      .then(r => r.json())
      .then(d => {
        if (d.dataUrl) {
          qrImage.src = d.dataUrl;
          qrLoading.classList.add('hidden');
        }
      })
      .catch(e => {
        qrLoading.textContent = 'Failed to generate QR';
      });
  }

  // Start 2-Minute Timer
  startTimer();

  showState('active');
}

function onChunkApprovedNext(msg) {
  playSound('chime');
  currentTxn = msg.transaction;
  totalTimerSeconds = 120;
  remainingSeconds = msg.remainingSeconds || 120;

  displayTotalAmount.textContent = Number(msg.transaction.total_amount).toFixed(2);
  receiptAmount.textContent = formatCurrency(msg.transaction.total_amount);

  const chunk = msg.nextChunk;
  splitNoticeBadge.classList.remove('hidden');
  splitNoticeBadge.textContent = `Payload ${msg.currentPart} of ${msg.totalParts} (Sequential Auto-Split)`;

  currentPartAmount.textContent = `Pay ${formatCurrency(chunk.amount)}`;
  if (upiIntentBtn) upiIntentBtn.href = chunk.upi_uri;

  qrLoading.classList.remove('hidden');
  fetch(`/api/qr?text=${encodeURIComponent(chunk.upi_uri)}`)
    .then(r => r.json())
    .then(d => {
      if (d.dataUrl) {
        qrImage.src = d.dataUrl;
        qrLoading.classList.add('hidden');
      }
    })
    .catch(e => {
      qrLoading.textContent = 'Failed to load QR';
    });

  // Restart 2-Minute Timer
  startTimer();

  showState('active');

  // Flash toast
  const existingToast = document.querySelector('.chunk-toast');
  if (existingToast) existingToast.remove();
  const toast = document.createElement('div');
  toast.className = 'alert success chunk-toast';
  toast.style.cssText = 'background: #dcfce7; color: #15803d; padding: 10px; border-radius: 8px; margin-bottom: 12px; font-weight: 600; font-size: 0.85rem;';
  toast.textContent = `✓ Payload ${msg.approvedChunk.part_index} Approved! Now presenting Payload ${msg.nextChunk.part_index} of ${msg.totalParts} (${formatCurrency(chunk.amount)}).`;
  paymentActiveState.prepend(toast);
  setTimeout(() => toast.remove(), 6000);
}

function startTimer() {
  clearInterval(timerInterval);

  function update() {
    const mins = Math.floor(remainingSeconds / 60);
    const secs = remainingSeconds % 60;
    timerText.textContent = `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;

    const percent = Math.max(0, (remainingSeconds / totalTimerSeconds) * 100);
    timerProgressFill.style.width = `${percent}%`;

    if (remainingSeconds <= 30) {
      timerText.classList.add('urgent');
      timerProgressFill.classList.add('urgent');
    } else {
      timerText.classList.remove('urgent');
      timerProgressFill.classList.remove('urgent');
    }

    if (remainingSeconds <= 0) {
      clearInterval(timerInterval);
      onPaymentExpired();
    }
    remainingSeconds--;
  }

  update();
  timerInterval = setInterval(update, 1000);
}

// User confirms payment
async function submitPaymentProof() {
  if (!currentTxn) return;
  const utr = userUtrInput.value.trim();

  try {
    const res = await fetch('/api/user/submit-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txnId: currentTxn.id, utr })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to submit payment');

    showState('submitted');
  } catch (err) {
    alert('Error submitting payment: ' + err.message);
  }
}

function onPaymentDecision(msg) {
  clearInterval(timerInterval);
  if (msg.status === 'approved') {
    playSound('chime');
    showState('approved');
  } else if (msg.status === 'denied') {
    showState('denied');
  }
}

function onPaymentExpired() {
  clearInterval(timerInterval);
  showState('expired');
}
