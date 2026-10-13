/**
 * @file splitAndUpi.test.js
 * @description Unit tests for splitAmount and buildUpiUri in upiService.
 */

const assert = require('assert');
const { splitAmount, buildUpiUri } = require('../../src/services/upiService');

console.log('--- Running UPI Service Unit Tests ---');

// Condition A: Amounts <= 1999
assert.deepStrictEqual(splitAmount(500), [500]);
assert.deepStrictEqual(splitAmount(1500), [1500]);
assert.deepStrictEqual(splitAmount(1999), [1999]);
console.log('✓ Condition A splits verified (<= 1999)');

// Condition B: Amounts > 1999
assert.deepStrictEqual(splitAmount(3000), [1999, 1001]);
assert.deepStrictEqual(splitAmount(3998), [1999, 1999]);
assert.deepStrictEqual(splitAmount(4500), [1999, 1999, 502]);
console.log('✓ Condition B splits verified (> 1999)');

// Zero / Invalid amounts
assert.deepStrictEqual(splitAmount(0), []);
assert.deepStrictEqual(splitAmount(-50), []);
assert.deepStrictEqual(splitAmount('invalid'), []);
console.log('✓ Edge cases handled gracefully');

// URI builder
const uri1 = buildUpiUri('store@paytm', 1999);
assert.strictEqual(uri1, 'upi://pay?pa=store@paytm&am=1999&cu=INR&tn=Verified%20Merchant%20Account');

const uri2 = buildUpiUri('store@paytm', 1999.50);
assert.strictEqual(uri2, 'upi://pay?pa=store@paytm&am=1999.50&cu=INR&tn=Verified%20Merchant%20Account');
console.log('✓ URI construction verified');

console.log('ALL SPLIT AND UPI TESTS PASSED!');
