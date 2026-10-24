import assert from 'node:assert/strict';
import test from 'node:test';
import { changeReportYear, currencyReports, currentReportPeriod, parseReportYear } from './report-presentation.ts';

const accounts = [
  { id: 1, name: 'Cash', currencyCode: 'BDT' },
  { id: 2, name: 'Bank', currencyCode: 'BDT' },
  { id: 3, name: 'Travel', currencyCode: 'USD' },
];
const empty = { summaries: [], spending: [] };

test('empty months retain separate metadata currencies and scoped account names', () => {
  const all = currencyReports(empty, accounts);
  assert.deepEqual(all.map(row => [row.currencyCode, row.accountNames, row.incomeMinor, row.expenseMinor, row.netMinor]), [
    ['BDT', ['Cash', 'Bank'], 0, 0, 0], ['USD', ['Travel'], 0, 0, 0],
  ]);
  assert.deepEqual(currencyReports(empty, accounts, 3).map(row => row.currencyCode), ['USD']);
  assert.deepEqual(currencyReports(empty, accounts, 99), []);
  assert.deepEqual(currencyReports(empty, []), []);
});

test('ranked spending and shares stay within the scoped currency', () => {
  const report = {
    summaries: [{ currencyCode: 'BDT', incomeMinor: 2000, expenseMinor: 1000 }, { currencyCode: 'USD', incomeMinor: 0, expenseMinor: 50 }],
    spending: [
      { categoryId: 1, categoryName: 'Food', currencyCode: 'BDT', amountMinor: 250 },
      { categoryId: 2, categoryName: 'Rent', currencyCode: 'BDT', amountMinor: 750 },
      { categoryId: 3, categoryName: 'Other', currencyCode: 'USD', amountMinor: 50 },
      { categoryId: 4, categoryName: 'Zero', currencyCode: 'BDT', amountMinor: 0 },
    ],
  };
  const [bdt] = currencyReports(report, accounts, 1);
  assert.equal(bdt.netMinor, 1000);
  assert.deepEqual(bdt.categories.map(row => [row.categoryName, row.share]), [['Rent', 75], ['Food', 25]]);
  assert.deepEqual(bdt.accountNames, ['Cash']);
  assert.equal(currencyReports(report, accounts, 3)[0].netMinor, -50);
  assert.deepEqual(report.spending.map(row => row.categoryId), [1, 2, 3, 4]);
});

test('zero expense shares remain finite and ties rank deterministically', () => {
  const rows = currencyReports({ summaries: [{ currencyCode: 'BDT', incomeMinor: 100, expenseMinor: 0 }], spending: [
    { categoryId: 2, categoryName: 'Zoo', currencyCode: 'BDT', amountMinor: 5 },
    { categoryId: 1, categoryName: 'Apple', currencyCode: 'BDT', amountMinor: 5 },
  ] }, accounts);
  assert.deepEqual(rows[0].categories.map(row => [row.categoryName, row.share]), [['Apple', 0], ['Zoo', 0]]);
});

test('local current month and year navigation preserve months without Date year-0..99 coercion', () => {
  const early = new Date(0);
  early.setFullYear(1, 1, 28);
  assert.deepEqual(currentReportPeriod(early), { year: 1, month: 1 });
  assert.deepEqual(changeReportYear({ year: 1, month: 1 }, -1), { year: 1, month: 1 });
  assert.deepEqual(changeReportYear({ year: 99, month: 11 }, 1), { year: 100, month: 11 });
  assert.deepEqual(changeReportYear({ year: 9999, month: 0 }, 1), { year: 9999, month: 0 });
  for (const year of ['1', '0099', '2024', '9999']) assert.equal(parseReportYear(year), Number(year));
  for (const invalid of ['', '0', '10000', '-1', '2.5', ' 2024', 'year']) assert.equal(parseReportYear(invalid), undefined);
});
