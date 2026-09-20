const { splitAmount, buildUpiUri, MerchantStore, TransactionStore } = require('./db');

console.log('=== 1. Testing splitAmount (Condition A & Condition B) ===');
const s500 = splitAmount(500);
console.log('Split 500:', s500);
if (s500.length !== 1 || s500[0] !== 500) throw new Error('Failed split 500');

const s1500 = splitAmount(1500);
console.log('Split 1500:', s1500);
if (s1500.length !== 1 || s1500[0] !== 1500) throw new Error('Failed split 1500');

const s1999 = splitAmount(1999);
console.log('Split 1999:', s1999);
if (s1999.length !== 1 || s1999[0] !== 1999) throw new Error('Failed split 1999');

const s3000 = splitAmount(3000);
console.log('Split 3000:', s3000); // [1999, 1001]
if (s3000.length !== 2 || s3000[0] !== 1999 || s3000[1] !== 1001) throw new Error('Failed split 3000');

const s4500 = splitAmount(4500);
console.log('Split 4500:', s4500); // [1999, 1999, 502]
if (s4500.length !== 3 || s4500[0] !== 1999 || s4500[1] !== 1999 || s4500[2] !== 502) throw new Error('Failed split 4500');

console.log('\n=== 2. Testing UPI URI Formatting (Condition A) ===');
const uri = buildUpiUri('paytm.s1m66cw@pty', 598);
console.log('Formatted UPI URI:', uri);
const expectedUri = 'upi://pay?pa=paytm.s1m66cw@pty&am=598&cu=INR&tn=Verified Merchant Account';
if (uri !== expectedUri) throw new Error(`URI mismatch: ${uri} !== ${expectedUri}`);

console.log('\n=== 3. Testing Demo Merchant (MC-99) ===');
const demo = MerchantStore.getDemoMerchant();
console.log('Demo Merchant Code:', demo.merchant_code, 'UPI:', demo.upi_id);
if (demo.merchant_code !== 'MC-99') throw new Error('Demo merchant code must be MC-99');

console.log('\n=== 4. Testing Merchant Creation & Unique Code (MC-XX) ===');
const testPhone = '97' + Math.floor(10000000 + Math.random() * 90000000);
const merchant = MerchantStore.create({
  phone: testPhone,
  password: 'pass' + Math.random(),
  provider: 'paytm',
  upi_id: `${testPhone}@paytm`
});
console.log('Created merchant code:', merchant.merchant_code, 'Phone:', merchant.phone);
if (!merchant.merchant_code.startsWith('MC-')) throw new Error('Merchant code must start with MC-');

const found = MerchantStore.findByMerchantCode(merchant.merchant_code);
console.log('Found merchant by code:', found ? found.phone : 'Not found');
if (!found) throw new Error('Failed to find merchant by code');

console.log('\n=== 5. Testing Transaction Auto-Splitting & Sequential Approvals ===');
const txn = TransactionStore.create({
  merchant_id: merchant.id,
  total_amount: 3000 // splits into [1999, 1001]
});
console.log('Created Txn:', txn.id, 'Total Chunks:', txn.split_count, 'Current:', txn.current_part_index);
if (txn.split_count !== 2) throw new Error('Expected 2 chunks');

console.log('Approving Chunk 1 (1999):');
const step1 = TransactionStore.approveCurrentChunk(txn.id);
console.log('   Completed?', step1.completed, 'Next Chunk Part:', step1.nextChunk ? step1.nextChunk.part_index : 'None');
if (step1.completed !== false) throw new Error('Expected incomplete after chunk 1');
if (step1.nextChunk.amount !== 1001) throw new Error('Expected chunk 2 to be 1001');

console.log('Approving Chunk 2 (1001):');
const step2 = TransactionStore.approveCurrentChunk(txn.id);
console.log('   Completed?', step2.completed, 'Overall Status:', step2.txn.status);
if (step2.completed !== true) throw new Error('Expected complete after chunk 2');
if (step2.txn.status !== 'approved') throw new Error('Expected status approved');

console.log('\n🎉 ALL UNIT TESTS PASSED SUCCESSFULLY!');
