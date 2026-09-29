const { TransactionStore, MerchantStore } = require('./db');
const assert = require('assert');

console.log('--- Testing Multi-UPI Destination Routing ---');

// 1. Get or create demo merchant
const demo = MerchantStore.getDemoMerchant();
console.log('Demo merchant ID:', demo.id);

// 2. Test updating UPI IDs
const upiList = ['dest1@paytm', 'dest2@paytm', 'dest3@paytm'];
const updatedMerchant = MerchantStore.updateUpi(demo.id, upiList[0], upiList);
assert.strictEqual(updatedMerchant.upi_id, 'dest1@paytm');
assert.deepStrictEqual(updatedMerchant.upi_ids, upiList);
console.log('✓ MerchantStore.updateUpi saved multiple UPI IDs:', updatedMerchant.upi_ids);

// 3. Create a transaction of ₹4500 (splits into 1999, 1999, 502 -> 3 chunks)
const txn = TransactionStore.create({
  merchant_id: demo.id,
  user_code: 'MC-99',
  total_amount: 4500,
  upi_ids: ['upiA@paytm', 'upiB@paytm']
});

console.log(`Created transaction with ${txn.chunks.length} chunks across 2 UPI IDs`);
assert.strictEqual(txn.chunks.length, 3);
assert.strictEqual(txn.chunks[0].amount, 1999);
assert.strictEqual(txn.chunks[0].upi_id, 'upiA@paytm');
assert.ok(txn.chunks[0].upi_uri.includes('pa=upiA@paytm'), 'Chunk 0 URI should target upiA@paytm');

assert.strictEqual(txn.chunks[1].amount, 1999);
assert.strictEqual(txn.chunks[1].upi_id, 'upiB@paytm');
assert.ok(txn.chunks[1].upi_uri.includes('pa=upiB@paytm'), 'Chunk 1 URI should target upiB@paytm');

assert.strictEqual(txn.chunks[2].amount, 502);
assert.strictEqual(txn.chunks[2].upi_id, 'upiA@paytm'); // Round robin back to index 0
assert.ok(txn.chunks[2].upi_uri.includes('pa=upiA@paytm'), 'Chunk 2 URI should target upiA@paytm');

console.log('✓ Sequential chunk destination routing verified:');
txn.chunks.forEach((c, i) => {
  console.log(`  Payload ${c.part_index}: ₹${c.amount} ➔ Destination UPI: ${c.upi_id} | URI: ${c.upi_uri}`);
});

// 4. Test approval transition to next chunk
const step1 = TransactionStore.approveCurrentChunk(txn.id);
assert.strictEqual(step1.completed, false);
assert.strictEqual(step1.approvedChunk.upi_id, 'upiA@paytm');
assert.strictEqual(step1.nextChunk.upi_id, 'upiB@paytm');
console.log('✓ Chunk 1 approved, next chunk is Payload 2 with destination:', step1.nextChunk.upi_id);

const step2 = TransactionStore.approveCurrentChunk(txn.id);
assert.strictEqual(step2.completed, false);
assert.strictEqual(step2.nextChunk.upi_id, 'upiA@paytm');
console.log('✓ Chunk 2 approved, next chunk is Payload 3 with destination:', step2.nextChunk.upi_id);

const step3 = TransactionStore.approveCurrentChunk(txn.id);
assert.strictEqual(step3.completed, true);
assert.strictEqual(step3.txn.status, 'approved');
console.log('✓ All chunks approved successfully!');

console.log('ALL MULTI-UPI TESTS PASSED!');
