import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

// Resolve the `@/lib/` path alias that the app bundler provides.
registerHooks({
  resolve: (specifier, context, next) =>
    specifier.startsWith('@/lib/')
      ? {
          url: new URL(`../../lib/${specifier.slice(6)}.ts`, import.meta.url).href,
          shortCircuit: true,
        }
      : next(specifier, context),
});
const {
  listSections,
  listTotals,
  markMatches,
  matchesSearch,
  periodBack,
  rowView,
  searchPlaceholder,
  searchSections,
} = await import('./list.ts');

const day = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 86400000);
const today = day(2026, 11, 12);
const cash = 1;
const card = 2;
/** The card in view: All accounts, the card of one Account in a deck, or the only Account. */
const allAccounts = { face: 'pace', accountId: null };
const trend = (accountId) => ({ face: 'trend', accountId });
const onlyAccount = { face: 'pace', accountId: cash };
const row = (patch = {}) => ({
  id: 1,
  type: 'EXPENSE',
  amountMinor: 45000,
  date: today,
  accountId: cash,
  transferAccountId: null,
  accountName: 'Cash',
  transferAccountName: null,
  currencyCode: 'BDT',
  categoryName: 'Restaurants',
  parentCategoryName: 'Food',
  categoryEmoji: '🍔',
  note: null,
  excludeFromReport: 0,
  ...patch,
});
const transfer = (patch = {}) =>
  row({
    type: 'TRANSFER',
    accountName: 'Cash',
    transferAccountId: card,
    transferAccountName: 'Card',
    categoryName: null,
    parentCategoryName: null,
    categoryEmoji: null,
    ...patch,
  });

test('a row on All accounts names the Category, then the Account and the note', () => {
  assert.deepEqual(rowView(row({ note: 'Lunch with Rahim' }), allAccounts), {
    title: 'Restaurants',
    detail: 'Cash · Lunch with Rahim',
    amount: '−৳450.00',
    tone: 'normal',
    icon: { kind: 'category', text: '🍔' },
  });
});

test('a row on one Account shows only the note, or no second line', () => {
  assert.equal(rowView(row({ note: 'Lunch' }), trend(cash)).detail, 'Lunch');
  assert.equal(rowView(row(), trend(cash)).detail, null);
});

test('a row with no emoji shows the first letter of its Category', () => {
  assert.deepEqual(rowView(row({ categoryEmoji: null, categoryName: 'rent' }), allAccounts).icon, {
    kind: 'category',
    text: 'R',
  });
});

test('Income is green, and a row excluded from reports is grey only on a Pace card', () => {
  assert.equal(rowView(row({ type: 'INCOME' }), allAccounts).tone, 'income');
  assert.equal(rowView(row({ type: 'INCOME' }), allAccounts).amount, '+৳450.00');
  const excluded = row({ excludeFromReport: 1 });
  assert.equal(rowView(excluded, allAccounts).tone, 'muted');
  assert.equal(rowView(excluded, allAccounts).amount, '−৳450.00', 'the sign stays');
  assert.equal(rowView(excluded, trend(cash)).tone, 'normal');
});

test('a lending row keeps its title and the icon of its Category', () => {
  const view = rowView(row({ lendingKind: 'LEND', personName: 'Rahim' }), allAccounts);
  assert.equal(view.title, 'Lent to Rahim');
  assert.deepEqual(view.icon, { kind: 'category', text: '🍔' });
});

test('a Transfer on All accounts shows its route and a grey amount with no sign', () => {
  assert.deepEqual(rowView(transfer(), allAccounts), {
    title: 'Cash → Card',
    detail: 'Transfer',
    amount: '৳450.00',
    tone: 'muted',
    icon: { kind: 'transfer' },
  });
  assert.equal(rowView(transfer({ note: 'Bill' }), allAccounts).detail, 'Bill');
});

test('a Transfer on one Account says where the money went or came from', () => {
  const out = rowView(transfer(), trend(cash));
  assert.equal(out.title, 'To Card');
  assert.equal(out.amount, '−৳450.00');
  assert.equal(out.tone, 'normal');
  const incoming = rowView(transfer(), trend(card));
  assert.equal(incoming.title, 'From Cash');
  assert.equal(incoming.amount, '+৳450.00');
  assert.equal(incoming.tone, 'income');
});

test('the only Account uses the Pace rule but does not repeat its name', () => {
  assert.equal(rowView(row({ note: 'Lunch' }), onlyAccount).detail, 'Lunch');
  assert.equal(rowView(row({ excludeFromReport: 1 }), onlyAccount).tone, 'muted');
  assert.deepEqual(listTotals([row(), row({ type: 'INCOME', amountMinor: 100 })], onlyAccount), [
    { text: 'Spent ৳450.00', tone: 'muted' },
    { text: '+৳1.00', tone: 'income' },
  ]);
});

test('totals on All accounts count reportable spending and income for each currency', () => {
  const rows = [
    row({ amountMinor: 90000 }),
    row({ amountMinor: 1200, currencyCode: 'USD' }),
    row({ type: 'INCOME', amountMinor: 5000 }),
    row({ amountMinor: 7000, excludeFromReport: 1 }),
    transfer({ amountMinor: 30000 }),
  ];
  assert.deepEqual(listTotals(rows, allAccounts), [
    { text: 'Spent ৳900.00 $12.00', tone: 'muted' },
    { text: '+৳50.00', tone: 'income' },
  ]);
  assert.deepEqual(listTotals([transfer()], allAccounts), [], 'a day of Transfers has no total');
});

test('totals on one Account are the change of its balance, with Transfers and excluded rows', () => {
  const rows = [
    row({ amountMinor: 1000 }),
    row({ amountMinor: 500, excludeFromReport: 1 }),
    row({ type: 'INCOME', amountMinor: 300 }),
    transfer({ amountMinor: 2000 }),
  ];
  assert.deepEqual(listTotals(rows, trend(cash)), [{ text: '−৳32.00', tone: 'muted' }]);
  assert.deepEqual(listTotals([transfer({ amountMinor: 2000 })], trend(card)), [
    { text: '+৳20.00', tone: 'income' },
  ]);
});

test('sections group rows by day, and older periods start with a divider', () => {
  const november = { start: day(2026, 11, 1), end: today + 1, label: 'November' };
  const october = { start: day(2026, 10, 1), end: day(2026, 11, 1), label: 'October' };
  const sections = listSections(
    [
      { period: november, rows: [row({ id: 3 }), row({ id: 2 }), row({ id: 1, date: today - 2 })] },
      { period: october, rows: [row({ id: 0, date: day(2026, 10, 20) })] },
    ],
    allAccounts,
  );
  assert.deepEqual(
    sections.map((s) => [s.date, s.data.map((item) => item.row?.id ?? item.kind)]),
    [
      [today, [3, 2]],
      [today - 2, [1]],
      [null, ['divider']],
      [day(2026, 10, 20), [0]],
    ],
  );
  assert.deepEqual(sections[0].totals, [{ text: 'Spent ৳900.00', tone: 'muted' }]);
  assert.deepEqual(sections[2].data[0], {
    kind: 'divider',
    label: 'October',
    totals: [{ text: 'Spent ৳450.00', tone: 'muted' }],
  });
});

test('an empty period says so, and an empty older period has no change', () => {
  const november = { start: day(2026, 11, 1), end: today + 1, label: 'November' };
  const october = { start: day(2026, 10, 1), end: day(2026, 11, 1), label: 'October' };
  const sections = listSections(
    [
      { period: november, rows: [] },
      { period: october, rows: [] },
    ],
    allAccounts,
  );
  assert.deepEqual(
    sections.flatMap((s) => s.data),
    [
      { kind: 'message', text: 'No transactions in November yet.' },
      { kind: 'divider', label: 'October', totals: [{ text: 'No change', tone: 'muted' }] },
      { kind: 'message', text: 'No transactions in October.' },
    ],
  );
});

test('search matches the note, the Category, its parent, the Accounts and the person', () => {
  assert.ok(matchesSearch(row({ note: 'Lunch with RAHIM' }), ' rahim '));
  assert.ok(matchesSearch(row(), 'food'), 'the parent Category');
  assert.ok(matchesSearch(row(), 'cash'));
  assert.ok(matchesSearch(transfer(), 'card'));
  assert.ok(matchesSearch(row({ lendingKind: 'LEND', personName: 'Karim' }), 'kar'));
  assert.ok(!matchesSearch(row(), 'bus'));
});

test('search results have day headers with no totals', () => {
  const sections = searchSections([row({ id: 2 }), row({ id: 1, date: today - 1 })]);
  assert.deepEqual(
    sections.map((s) => [s.date, s.totals]),
    [
      [today, []],
      [today - 1, []],
    ],
  );
});

test('days come newest first even when the rows are out of order', () => {
  const sections = searchSections([
    row({ id: 1, date: today - 1 }),
    row({ id: 2 }),
    row({ id: 3, date: today - 1 }),
  ]);
  assert.deepEqual(
    sections.map((s) => [s.date, s.data.map((item) => item.row.id)]),
    [
      [today, [2]],
      [today - 1, [1, 3]],
    ],
  );
});

test('markMatches marks each match and keeps the case of the text', () => {
  assert.deepEqual(markMatches('Rahim and rahim', 'RAHIM'), [
    { text: 'Rahim', match: true },
    { text: ' and ', match: false },
    { text: 'rahim', match: true },
  ]);
  assert.deepEqual(markMatches('Lunch', ' '), [{ text: 'Lunch', match: false }]);
});

test('the search placeholder names the range of the cards', () => {
  assert.equal(
    searchPlaceholder({ range: 'month', monthStart: 1 }, 'November'),
    'Search transactions from November',
  );
  assert.equal(
    searchPlaceholder({ range: 'week', monthStart: 1 }, 'Week of 7 Nov'),
    'Search transactions from this week',
  );
  assert.equal(
    searchPlaceholder({ range: '90d', monthStart: 1 }, 'Last 90 days'),
    'Search transactions from the last 90 days',
  );
  assert.equal(
    searchPlaceholder({ range: 'month', monthStart: 25 }, '25 Oct – 24 Nov'),
    'Search transactions from 25 Oct – 24 Nov',
  );
});

test('periodBack walks back one full period at a time', () => {
  const month = { range: 'month', monthStart: 1 };
  assert.deepEqual(periodBack(month, today, 0), {
    start: day(2026, 11, 1),
    end: today + 1,
    label: 'November',
  });
  assert.deepEqual(periodBack(month, today, 1), {
    start: day(2026, 10, 1),
    end: day(2026, 11, 1),
    label: 'October',
  });
  assert.equal(periodBack(month, today, 11).label, 'December 2025', 'another year names it');
  assert.deepEqual(periodBack({ range: 'month', monthStart: 25 }, today, 1), {
    start: day(2026, 9, 25),
    end: day(2026, 10, 25),
    label: '25 Sep – 24 Oct',
  });
  assert.deepEqual(periodBack({ range: '90d', monthStart: 1 }, today, 1), {
    start: today - 179,
    end: today - 89,
    label: '17 May – 14 Aug',
  });
  assert.equal(periodBack({ range: 'year', monthStart: 1 }, today, 1).label, '2025');
  assert.deepEqual(periodBack({ range: 'week', monthStart: 1 }, today, 1), {
    start: day(2026, 10, 31),
    end: day(2026, 11, 7),
    label: 'Week of 31 Oct',
  });
});
