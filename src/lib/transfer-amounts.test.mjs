import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyTransferAmount as apply,
  firstTransferRate,
  formatTransferRate,
} from './transfer-amounts.ts';

const empty = () => ({
  base: 'USD',
  quote: 'BDT',
  rate: 122,
  typed: { pay: false, receive: false },
});
test('an untouched amount follows the rate, while two typed amounts make the rate follow', () => {
  let state = apply(empty(), 'receive', 12000, 'BDT');
  assert.equal(state.pay, 1464000);
  assert.equal(state.typed.pay, false);
  state = apply(state, 'pay', 1488000, 'BDT');
  assert.equal(state.receive, 12000);
  assert.equal(state.rate, 124);
  state = apply(state, 'receive', 10000, 'BDT');
  assert.equal(state.pay, 1488000);
  assert.equal(state.rate, 148.8);
});
test('changing the rate changes pays unless pays is the only typed amount', () => {
  const receive = apply(empty(), 'receive', 10000, 'BDT');
  assert.equal(apply(receive, 'rate', 125, 'BDT').pay, 1250000);
  const pay = apply(empty(), 'pay', 1220000, 'BDT');
  const changed = apply(pay, 'rate', 125, 'BDT');
  assert.equal(changed.pay, 1220000);
  assert.equal(changed.receive, 9760);
  const both = apply(receive, 'pay', 1300000, 'BDT');
  assert.equal(apply(both, 'rate', 125, 'BDT').pay, 1250000);
});
test('the same rate direction converts reverse Transfers and rounds only amounts to minor units', () => {
  let state = apply(empty(), 'pay', 10001, 'USD');
  assert.equal(state.receive, 1220122);
  state = apply(state, 'rate', 121.4567, 'USD');
  assert.equal(state.receive, 1214688);
  assert.equal(state.rate, 121.4567);
});
test('without a first rate, both amounts or one amount and a rate are necessary', () => {
  const state = { ...empty(), rate: undefined };
  const pay = apply(state, 'pay', 10000, 'BDT');
  assert.equal(pay.receive, undefined);
  assert.equal(apply(pay, 'receive', 100, 'BDT').rate, 100);
  assert.equal(apply(pay, 'rate', 100, 'BDT').receive, 100);
  const receive = apply(state, 'receive', 100, 'BDT');
  assert.equal(apply(receive, 'rate', 100, 'BDT').pay, 10000);
});
test('clearing an amount releases ownership; an amount change never overwrites another typed amount', () => {
  let state = apply(empty(), 'pay', 1220000, 'BDT');
  state = apply(state, 'receive', 12000, 'BDT');
  state = apply(state, 'pay', undefined, 'BDT');
  assert.equal(state.typed.pay, false);
  assert.equal(state.pay, undefined);
  state = apply(state, 'receive', 10000, 'BDT');
  assert.equal(state.pay, 1016667);
});
test('Display Rate takes priority, last Transfer normalizes to at least one, otherwise receives is base', () => {
  const last = { source: 'BDT', destination: 'USD', paid: 1214000, received: 10000, date: 20000 };
  const display = { base: 'BDT', quote: 'USD', rate: 0.0082 };
  assert.deepEqual(firstTransferRate('USD', 'BDT', display, last), display);
  assert.deepEqual(firstTransferRate('USD', 'BDT', { base: 'EUR', quote: 'USD', rate: 2 }, last), {
    base: 'USD',
    quote: 'BDT',
    rate: 121.4,
    date: 20000,
  });
  assert.deepEqual(firstTransferRate('USD', 'BDT', null, null), {
    base: 'BDT',
    quote: 'USD',
    rate: undefined,
  });
  assert.deepEqual(
    firstTransferRate('BDT', 'USD', null, {
      source: 'USD',
      destination: 'BDT',
      paid: 100,
      received: 12200,
      date: 20001,
    }),
    { base: 'USD', quote: 'BDT', rate: 122, date: 20001 },
  );
  assert.equal(formatTransferRate(122), '122.00');
  assert.equal(formatTransferRate(0.0082), '0.0082');
  assert.equal(formatTransferRate(1.23456), '1.2346');
});
