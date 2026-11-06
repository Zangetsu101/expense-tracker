import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateAmount } from './amount-calculator.ts';

test('calculates everyday amounts with precedence and currency rounding', () => {
  for (const [expression, expected] of [['120+80−25', '175.00'], ['12×3+6÷2', '39.00'], ['0.1+0.2', '0.30'], ['10÷3', '3.33'], ['1.005', '1.01'], ['100×.15', '15.00'], ['5−10', '-5.00'], ['2×−3', '-6.00']]) {
    assert.equal(calculateAmount(expression), expected);
  }
});
test('rejects incomplete, unsafe and non-arithmetic input', () => {
  for (const expression of ['', '1+', '2÷0', '2..1', '1e3', 'alert(1)', '90071992547410', '2**3']) {
    assert.throws(() => calculateAmount(expression), expression);
  }
});
