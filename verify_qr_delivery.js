const http = require('http');
const path = require('path');
const fs = require('fs');

// We simulate EROFS on repo data directory to test Vercel serverless conditions
const origWrite = fs.writeFileSync;
fs.writeFileSync = function(file, ...args) {
  if (typeof file === 'string' && file.includes(path.join('upi-merchant-system', 'data'))) {
    const err = new Error('EROFS: read-only file system, open ' + file);
    err.code = 'EROFS';
    throw err;
  }
  return origWrite.apply(this, [file, ...args]);
};

// Start the server
const server = require('./server');

function request(port, method, reqPath, body = null) {
  return new Promise((resolve, reject) => {
    const opt = {
      hostname: '127.0.0.1',
      port,
      path: reqPath,
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    const req = http.request(opt, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runTests() {
  const PORT = 3001;
  const appServer = server.listen(PORT, async () => {
    console.log(`Test server running on port ${PORT}`);
    let passed = 0;
    let failed = 0;

    function assert(cond, msg) {
      if (cond) {
        console.log(`  ✓ PASS: ${msg}`);
        passed++;
      } else {
        console.error(`  ✗ FAIL: ${msg}`);
        failed++;
      }
    }

    try {
      console.log('\n--- 1. Testing Terminal Connection & Slot Assignment ---');
      const sess1 = 'sess_user_1';
      const termRes = await request(PORT, 'GET', `/api/user/terminal/MC-99?sessionId=${sess1}`);
      assert(termRes.status === 200, 'Terminal endpoint returned 200');
      assert(termRes.body.valid === true, 'Terminal is valid for MC-99');
      assert(termRes.body.slot === 1, 'Terminal assigned to Slot 1');
      assert(termRes.body.activePayment === null, 'Initially no active payment');

      console.log('\n--- 2. Testing Merchant Sync Seeing Connected Slot ---');
      const sync1 = await request(PORT, 'GET', '/api/merchant/sync/m_demo');
      assert(sync1.status === 200, 'Merchant sync returned 200');
      assert(sync1.body.slotInfo.connectedCount >= 1, 'Merchant sees at least 1 connected slot');
      assert(sync1.body.slots[0].connected === true, 'Slot 1 is marked connected');

      console.log('\n--- 3. Testing Merchant Payment Creation (₹4500 Auto-Split) ---');
      const payReq = await request(PORT, 'POST', '/api/merchant/payment-request', {
        merchantId: 'm_demo',
        targetSlotCode: 'MC-99',
        amount: 4500,
        upi_id: 'merchant@paytm'
      });
      assert(payReq.status === 200, 'Payment request created with status 200');
      assert(payReq.body.transaction.total_amount === 4500, 'Total amount is 4500');
      assert(payReq.body.transaction.split_count === 3, 'Split count is 3 chunks');
      assert(payReq.body.transaction.chunks[0].amount === 1999, 'Chunk 1 is 1999');

      console.log('\n--- 4. Testing QR Code Delivery to Terminal ---');
      const termPoll1 = await request(PORT, 'GET', `/api/user/terminal/MC-99?sessionId=${sess1}`);
      assert(termPoll1.status === 200, 'Terminal poll returned 200');
      assert(termPoll1.body.activePayment !== null, 'activePayment is NOT null');
      const ap1 = termPoll1.body.activePayment;
      assert(ap1.chunkAmount === 1999, 'Current chunk amount is ₹1999');
      assert(ap1.currentPart === 1, 'Current part is 1 of 3');
      assert(typeof ap1.qrDataUrl === 'string' && ap1.qrDataUrl.startsWith('data:image/png;base64,'), 'Dynamic QR data URI generated and delivered to terminal');
      assert(ap1.upiUri.includes('am=1999'), 'UPI URI contains correct chunk amount');
      assert(ap1.remainingSeconds > 115, 'Countdown timer active (~120s)');

      console.log('\n--- 5. Testing Customer Submits UTR Proof ---');
      const submitRes = await request(PORT, 'POST', '/api/user/submit-payment', {
        txnId: ap1.id,
        utr: 'UTR9876543210'
      });
      assert(submitRes.status === 200, 'UTR submission returned 200');

      console.log('\n--- 6. Testing Merchant Sync Showing UTR Proof ---');
      const sync2 = await request(PORT, 'GET', '/api/merchant/sync/m_demo');
      assert(sync2.body.activePayment !== null, 'Merchant sees active payment');
      assert(sync2.body.activePayment.status === 'submitted', 'Status is submitted');
      assert(sync2.body.activePayment.utr === 'UTR9876543210', 'Merchant sees customer UTR');

      console.log('\n--- 7. Testing Merchant Approves Chunk 1 -> Chunk 2 Delivery ---');
      const app1 = await request(PORT, 'POST', '/api/merchant/payment-action', {
        merchantId: 'm_demo',
        action: 'approve',
        txnId: ap1.id
      });
      assert(app1.status === 200, 'Chunk 1 approval returned 200');
      assert(app1.body.completed === false, 'Transaction not completed yet (more chunks remaining)');

      const termPoll2 = await request(PORT, 'GET', `/api/user/terminal/MC-99?sessionId=${sess1}`);
      const ap2 = termPoll2.body.activePayment;
      assert(ap2.currentPart === 2, 'Terminal progressed to Chunk 2');
      assert(ap2.chunkAmount === 1999, 'Chunk 2 amount is ₹1999');
      assert(typeof ap2.qrDataUrl === 'string' && ap2.qrDataUrl.startsWith('data:image/png;base64,'), 'Chunk 2 QR code delivered to terminal');

      console.log('\n--- 8. Testing Approving Chunk 2 -> Chunk 3 Delivery ---');
      const app2 = await request(PORT, 'POST', '/api/merchant/payment-action', {
        merchantId: 'm_demo',
        action: 'approve',
        txnId: ap1.id
      });
      assert(app2.status === 200, 'Chunk 2 approval returned 200');

      const termPoll3 = await request(PORT, 'GET', `/api/user/terminal/MC-99?sessionId=${sess1}`);
      const ap3 = termPoll3.body.activePayment;
      assert(ap3.currentPart === 3, 'Terminal progressed to Chunk 3 (final part)');
      assert(ap3.chunkAmount === 502, 'Chunk 3 amount is ₹502');
      assert(typeof ap3.qrDataUrl === 'string' && ap3.qrDataUrl.startsWith('data:image/png;base64,'), 'Chunk 3 QR code delivered to terminal');

      console.log('\n--- 9. Testing Final Approval -> Instant Receipt ---');
      const app3 = await request(PORT, 'POST', '/api/merchant/payment-action', {
        merchantId: 'm_demo',
        action: 'approve',
        txnId: ap1.id
      });
      assert(app3.status === 200, 'Chunk 3 approval returned 200');
      assert(app3.body.completed === true, 'Entire payment marked completed');

      const termPollFinal = await request(PORT, 'GET', `/api/user/terminal/MC-99?sessionId=${sess1}`);
      assert(termPollFinal.body.activePayment === null, 'No active payment pending');
      assert(termPollFinal.body.lastTransaction.status === 'approved', 'Last transaction status is approved');
      assert(termPollFinal.body.lastTransaction.total_amount === 4500, 'Receipt total amount is 4500');

      console.log(`\n==========================================`);
      console.log(`TOTAL RESULTS: ${passed} PASSED, ${failed} FAILED`);
      console.log(`==========================================`);

      appServer.close(() => {
        process.exit(failed > 0 ? 1 : 0);
      });
    } catch (err) {
      console.error('Test execution error:', err);
      appServer.close(() => process.exit(1));
    }
  });
}

runTests();
