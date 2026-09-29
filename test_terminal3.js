const http = require('http');

function request(options, postData) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- STARTING 6-DIGIT CODE & TERMINAL 3 BLOCKING TESTS ---');
  let failures = 0;

  // 1. Test Demo Merchant Code is 6 Digits (999999)
  try {
    const res = await request({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/api/merchant/demo',
      method: 'GET'
    });
    const code = res.data?.merchant?.merchant_code;
    if (res.status === 200 && code === '999999' && /^\d{6}$/.test(code)) {
      console.log('✅ TEST 1 PASSED: Demo Merchant has 6-digit assigned code: ' + code);
    } else {
      console.error('❌ TEST 1 FAILED: Expected code 999999, got:', code, res.data);
      failures++;
    }
  } catch (e) {
    console.error('❌ TEST 1 FAILED with error:', e.message);
    failures++;
  }

  // 2. Test New Merchant Registration generates a 6-digit numeric code
  let newMerchantCode = '';
  try {
    const randomPhone = '9' + Math.floor(100000000 + Math.random() * 900000000);
    const res = await request({
      hostname: '127.0.0.1',
      port: 3000,
      path: '/api/merchant/register',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      phone: randomPhone,
      password: 'testpassword123',
      provider: 'paytm',
      upi_id: `${randomPhone}@paytm`,
      fee_paid: true
    });

    newMerchantCode = res.data?.merchant?.merchant_code;
    if (res.status === 200 && /^\d{6}$/.test(newMerchantCode)) {
      console.log('✅ TEST 2 PASSED: New Merchant assigned 6-digit numeric code: ' + newMerchantCode);
    } else {
      console.error('❌ TEST 2 FAILED: Expected 6-digit code, got:', newMerchantCode, res.data);
      failures++;
    }
  } catch (e) {
    console.error('❌ TEST 2 FAILED with error:', e.message);
    failures++;
  }

  // 3. Test Terminal 1 connection (Slot 1)
  const targetCode = newMerchantCode || '999999';
  const session1 = 'test-session-term-1';
  try {
    const res = await request({
      hostname: '127.0.0.1',
      port: 3000,
      path: `/api/user/poll/${targetCode}?sessionId=${session1}`,
      method: 'GET'
    });
    const slotNum = res.data.slot || res.data.slotNumber;
    if (res.status === 200 && slotNum === 1) {
      console.log('✅ TEST 3 PASSED: Terminal 1 connected to Slot 1 successfully.');
    } else {
      console.error('❌ TEST 3 FAILED: Terminal 1 response:', res.status, res.data);
      failures++;
    }
  } catch (e) {
    console.error('❌ TEST 3 FAILED with error:', e.message);
    failures++;
  }

  // 4. Test Terminal 2 connection (Slot 2)
  const session2 = 'test-session-term-2';
  try {
    const res = await request({
      hostname: '127.0.0.1',
      port: 3000,
      path: `/api/user/poll/${targetCode}?sessionId=${session2}`,
      method: 'GET'
    });
    const slotNum = res.data.slot || res.data.slotNumber;
    if (res.status === 200 && slotNum === 2) {
      console.log('✅ TEST 4 PASSED: Terminal 2 connected to Slot 2 successfully.');
    } else {
      console.error('❌ TEST 4 FAILED: Terminal 2 response:', res.status, res.data);
      failures++;
    }
  } catch (e) {
    console.error('❌ TEST 4 FAILED with error:', e.message);
    failures++;
  }

  // 5. Test Terminal 3 connection attempt (MUST BE BLOCKED with 403 & warning)
  const session3 = 'test-session-term-3';
  try {
    const res = await request({
      hostname: '127.0.0.1',
      port: 3000,
      path: `/api/user/poll/${targetCode}?sessionId=${session3}`,
      method: 'GET'
    });
    if (res.status === 403 && res.data.terminal3Blocked === true && res.data.message.includes('ACCESS BLOCKED')) {
      console.log('✅ TEST 5 PASSED: Terminal 3 connection BLOCKED with HTTP 403 and warning sign message:');
      console.log('   Message:', res.data.message);
    } else {
      console.error('❌ TEST 5 FAILED: Terminal 3 was not blocked as expected:', res.status, res.data);
      failures++;
    }
  } catch (e) {
    console.error('❌ TEST 5 FAILED with error:', e.message);
    failures++;
  }

  // 6. Test direct access to Terminal 3 route (/api/terminal/3)
  try {
    const res = await request({
      hostname: '127.0.0.1',
      port: 3000,
      path: `/api/terminal/3`,
      method: 'GET'
    });
    if (res.status === 403 && res.data.terminal3Blocked === true && res.data.blocked === true) {
      console.log('✅ TEST 6 PASSED: Dedicated /api/terminal/3 endpoint returns 403 Forbidden with warning sign payload.');
    } else {
      console.error('❌ TEST 6 FAILED: /api/terminal/3 unexpected response:', res.status, res.data);
      failures++;
    }
  } catch (e) {
    console.error('❌ TEST 6 FAILED with error:', e.message);
    failures++;
  }

  // 7. Test slot status returns 3 slots with Terminal 3 blocked
  try {
    const res = await request({
      hostname: '127.0.0.1',
      port: 3000,
      path: `/api/merchant/sync/m_demo`,
      method: 'GET'
    });
    const slots = res.data?.slotInfo?.slots || [];
    const t3 = slots.find(s => s.slotNumber === 3);
    if (res.status === 200 && t3 && t3.blocked === true) {
      console.log('✅ TEST 7 PASSED: Merchant slot status explicitly exposes Terminal 3 as blocked (Max 2 Allowed).');
    } else {
      console.error('❌ TEST 7 FAILED: Slot 3 status:', t3, res.data);
      failures++;
    }
  } catch (e) {
    console.error('❌ TEST 7 FAILED with error:', e.message);
    failures++;
  }

  if (failures === 0) {
    console.log('\n🎉 ALL 7 INTEGRATION TESTS PASSED PERFECTLY!');
    process.exit(0);
  } else {
    console.error(`\n❌ ${failures} TEST(S) FAILED.`);
    process.exit(1);
  }
}

runTests();
