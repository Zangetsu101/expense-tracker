import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === './database.ts') return { url: 'test:dates', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'test:dates')
      return {
        format: 'module',
        source: `export const database = () => {}; export const epochDay = (d) => Math.floor(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000);`,
        shortCircuit: true,
      };
    if (url.endsWith('.ts')) {
      const result = next(url, { ...context, format: 'module' });
      return { ...result, source: stripTypeScriptTypes(result.source.toString()) };
    }
    return next(url, context);
  },
});
const { calculateCardBill } = await import('./credit-cards.ts');
const day = (text) => Date.parse(text) / 86400000;
const card = { accountId: 2, parentAccountId: 1, statementDay: 20, dueDay: 5 };
const movement = (date, changeMinor) => ({ date: day(date), changeMinor });
test('statement-day purchases are billed; newer spending is separate and partial settlement pays the bill', () => {
  const bill = calculateCardBill(
    card,
    -10000,
    [
      movement('2026-10-20', -2000),
      movement('2026-10-21', -4000),
      movement('2026-10-25', 5000),
      movement('2026-11-10', -9000),
    ],
    day('2026-11-06'),
  );
  assert.equal(bill.billMinor, 7000);
  assert.equal(bill.owedMinor, 11000);
  assert.equal(bill.unbilledMinor, 4000);
  assert.equal(bill.statementDate, day('2026-10-20'));
  assert.equal(bill.dueDate, day('2026-11-05'));
  assert.equal(bill.overdue, true);
});
test('statement and due days clamp in short months, and due date itself is not overdue', () => {
  const bill = calculateCardBill(
    { ...card, statementDay: 31, dueDay: 31 },
    -500,
    [],
    day('2026-03-15'),
  );
  assert.equal(bill.statementDate, day('2026-02-28'));
  assert.equal(bill.dueDate, day('2026-03-31'));
  assert.equal(bill.overdue, false);
  assert.equal(calculateCardBill(card, -500, [], day('2026-11-05')).overdue, false);
});
test('unscheduled cards bill all owed and overpayments remain credit', () => {
  const settings = { ...card, statementDay: null, dueDay: null };
  assert.equal(calculateCardBill(settings, -1500, [], day('2026-11-01')).billMinor, 1500);
  const paid = calculateCardBill(card, -1000, [movement('2026-10-25', 1500)], day('2026-11-01'));
  assert.equal(paid.creditMinor, 500);
  assert.equal(paid.billMinor, 0);
  assert.equal(paid.owedMinor, 0);
  assert.equal(paid.overdue, false);
});
test('refunds pay down a bill, and changes to historical purchases recalculate it', () => {
  const now = day('2026-11-01');
  assert.equal(
    calculateCardBill(card, 0, [movement('2026-10-19', -4000), movement('2026-10-22', 1000)], now)
      .billMinor,
    3000,
  );
  assert.equal(
    calculateCardBill(card, 0, [movement('2026-10-19', -2500), movement('2026-10-22', 1000)], now)
      .billMinor,
    1500,
  );
});

test('settling the statement leaves newer purchases unbilled', () => {
  const bill = calculateCardBill(
    card,
    -1000,
    [movement('2026-10-21', -500), movement('2026-10-25', 1000)],
    day('2026-11-01'),
  );
  assert.equal(bill.billMinor, 0);
  assert.equal(bill.owedMinor, 500);
  assert.equal(bill.unbilledMinor, 500);
});
