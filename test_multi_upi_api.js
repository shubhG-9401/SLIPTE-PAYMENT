const http = require('http');
const assert = require('assert');

function postJson(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let respBody = '';
      res.on('data', chunk => respBody += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(respBody) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: respBody });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:3000' + path, res => {
      let respBody = '';
      res.on('data', chunk => respBody += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(respBody) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: respBody });
        }
      });
    }).on('error', reject);
  });
}

async function runApiTests() {
  console.log('--- Testing Multi-UPI HTTP API Endpoints ---');

  // 1. Get demo merchant
  const demoRes = await getJson('/api/merchant/demo');
  assert.strictEqual(demoRes.status, 200);
  const merchant = demoRes.data.merchant;
  console.log('Demo merchant retrieved:', merchant.phone, 'Code:', merchant.merchant_code);

  // 2. Update UPI IDs via API
  const upiIds = ['shop1@paytm', 'shop2@paytm', 'shop3@paytm'];
  const updateRes = await postJson('/api/merchant/update-upi', {
    merchantId: merchant.id,
    upi_id: upiIds[0],
    upi_ids: upiIds
  });
  assert.strictEqual(updateRes.status, 200);
  assert.deepStrictEqual(updateRes.data.merchant.upi_ids, upiIds);
  console.log('✓ POST /api/merchant/update-upi updated UPI IDs:', updateRes.data.merchant.upi_ids);

  // 3. Initiate payment request of ₹3998 (splits into 2 chunks of 1999)
  const payReqRes = await postJson('/api/merchant/payment-request', {
    merchantId: merchant.id,
    targetSlotCode: merchant.merchant_code,
    amount: 3998,
    upi_ids: ['store_alpha@paytm', 'store_beta@paytm']
  });

  assert.strictEqual(payReqRes.status, 200);
  const txn = payReqRes.data.transaction;
  assert.strictEqual(txn.split_count, 2);
  assert.strictEqual(txn.chunks[0].upi_id, 'store_alpha@paytm');
  assert.strictEqual(txn.chunks[1].upi_id, 'store_beta@paytm');
  assert.ok(txn.chunks[0].upi_uri.includes('pa=store_alpha@paytm'));
  assert.ok(txn.chunks[1].upi_uri.includes('pa=store_beta@paytm'));
  console.log('✓ POST /api/merchant/payment-request assigned distinct UPIs:');
  console.log('  Chunk 1 ->', txn.chunks[0].upi_id);
  console.log('  Chunk 2 ->', txn.chunks[1].upi_id);

  // 4. Poll user terminal to verify active payment has chunk destination UPI
  const termRes = await getJson(`/api/user/terminal/${merchant.merchant_code}?sessionId=test_sess_api`);
  assert.strictEqual(termRes.status, 200);
  assert.ok(termRes.data.activePayment, 'Active payment should be present');
  assert.strictEqual(termRes.data.activePayment.chunk.upi_id, 'store_alpha@paytm');
  assert.ok(termRes.data.activePayment.upiUri.includes('pa=store_alpha@paytm'));
  assert.ok(termRes.data.activePayment.qrDataUrl, 'QR Data URL generated');
  console.log('✓ User Terminal receives Chunk 1 QR targeting:', termRes.data.activePayment.chunk.upi_id);

  // 5. Merchant approves Chunk 1
  const actionRes = await postJson('/api/merchant/payment-action', {
    merchantId: merchant.id,
    txnId: txn.id,
    action: 'approve'
  });
  assert.strictEqual(actionRes.status, 200);
  assert.strictEqual(actionRes.data.completed, false);
  assert.strictEqual(actionRes.data.nextChunk.upi_id, 'store_beta@paytm');
  console.log('✓ Chunk 1 approved. Next chunk pushed with destination:', actionRes.data.nextChunk.upi_id);

  // 6. User Terminal polls again for Chunk 2
  const termRes2 = await getJson(`/api/user/terminal/${merchant.merchant_code}?sessionId=test_sess_api`);
  assert.strictEqual(termRes2.status, 200);
  assert.strictEqual(termRes2.data.activePayment.chunk.upi_id, 'store_beta@paytm');
  assert.ok(termRes2.data.activePayment.upiUri.includes('pa=store_beta@paytm'));
  console.log('✓ User Terminal now receives Chunk 2 QR targeting:', termRes2.data.activePayment.chunk.upi_id);

  // 7. Merchant approves Chunk 2 (completion)
  const actionRes2 = await postJson('/api/merchant/payment-action', {
    merchantId: merchant.id,
    txnId: txn.id,
    action: 'approve'
  });
  assert.strictEqual(actionRes2.status, 200);
  assert.strictEqual(actionRes2.data.completed, true);
  console.log('✓ Chunk 2 approved. Full transaction completed!');

  console.log('ALL API TESTS PASSED SUCCESSFULLY!');
}

runApiTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
