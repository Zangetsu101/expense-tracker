import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateAmount, pressAmountKey } from './amount-calculator.ts';

test('calculates everyday amounts with precedence and currency rounding', () => {
  for (const [expression, expected] of [
    ['120+80−25', '175.00'],
    ['12×3+6÷2', '39.00'],
    ['0.1+0.2', '0.30'],
    ['10÷3', '3.33'],
    ['1.005', '1.01'],
    ['100×.15', '15.00'],
    ['5−10', '-5.00'],
    ['2×−3', '-6.00'],
  ]) {
    assert.equal(calculateAmount(expression), expected);
  }
});
test('rejects incomplete, unsafe and non-arithmetic input', () => {
  for (const expression of ['', '1+', '2÷0', '2..1', '1e3', 'alert(1)', '90071992547410', '2**3']) {
    assert.throws(() => calculateAmount(expression), expression);
  }
});

test('rate calculations retain four decimal places while money still rounds to cents', () => {
  assert.equal(calculateAmount('1 ÷ 122', 4), '0.0082');
  assert.equal(calculateAmount('1 ÷ 122'), '0.01');
  assert.equal(calculateAmount('121.4567 × 2', 4), '242.9134');
});

const type = (keys, amount = '') =>
  keys.reduce((entry, key) => pressAmountKey(entry, key), { amount, evaluated: false, error: '' });

test('keypad keys build on the entry that the key before them returned', () => {
  assert.equal(type(['1', '2', '2']).amount, '122');
  assert.equal(type(['4', '+', '×', '5', '⌫', '6']).amount, '4×6');
  assert.equal(type(['C'], '12.50').amount, '');
});

test('a digit after equals starts a new amount, and an operator continues the result', () => {
  assert.deepEqual(type(['4', '+', '5', '=']), { amount: '9.00', evaluated: true, error: '' });
  assert.equal(type(['4', '+', '5', '=', '7']).amount, '7');
  assert.equal(type(['4', '+', '5', '=', '+', '1']).amount, '9.00+1');
});

test('double zero appends two zeros and starts a new amount after equals', () => {
  assert.equal(type(['5', '00']).amount, '500');
  assert.equal(type(['5', '.', '00']).amount, '5.00');
  assert.equal(type(['5', '=', '00', '7']).amount, '007');
});

test('equals on an incomplete calculation keeps the amount and reports the error', () => {
  const failed = type(['4', '+', '=']);
  assert.equal(failed.amount, '4+');
  assert.match(failed.error, /complete calculation/);
  assert.equal(pressAmountKey(failed, '5').error, '');
});

test('equals keeps the precision that the keypad asks for', () => {
  assert.equal(
    pressAmountKey({ amount: '1÷122', evaluated: false, error: '' }, '=', 4).amount,
    '0.0082',
  );
});
