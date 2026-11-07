import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { decodeBackup } from '../src/lib/backup.ts';

const modes = ['EXPENSE', 'INCOME'];
const increment = (counts, key) => (counts[key] = (counts[key] ?? 0) + 1);
const date = (day) => new Date(day * 86400000).toISOString().slice(0, 10);
const asciiLower = (value) => value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const categoryTie = (a, b) => compareText(asciiLower(a.name), asciiLower(b.name)) || a.id - b.id;

export function adaptBackup(json) {
  const backup = decodeBackup(json);
  for (const rows of [backup.accounts, backup.categories, backup.transactions]) {
    if (
      rows.some((row) => !row || !Number.isSafeInteger(row.id)) ||
      new Set(rows.map((row) => row.id)).size !== rows.length
    ) {
      throw new Error('Missing or duplicate record IDs');
    }
  }
  const accounts = new Map(backup.accounts.map((row) => [row.id, row]));
  const categories = backup.categories.filter(
    (row) => modes.includes(row.type) && row.needsReview === false && typeof row.name === 'string',
  );
  const byCategory = new Map(categories.map((row) => [row.id, row]));
  const linked = new Set((backup.lendingEntries ?? []).map((row) => row.transactionId));
  const excluded = {};
  const sources = {};
  const eligibleSources = {};
  const rows = [];
  const baselineRows = [];
  for (const row of backup.transactions) {
    const source = ['IMPORT', 'MANUAL'].includes(row.source) ? row.source : 'OTHER_OR_MISSING';
    increment(sources, source);
    const account = accounts.get(row.accountId);
    const category = byCategory.get(row.categoryId);
    if (
      account &&
      /^[A-Z]{3}$/.test(account.currencyCode ?? '') &&
      Number.isSafeInteger(row.dateEpochDay) &&
      Math.abs(row.dateEpochDay) <= 100000000 &&
      modes.includes(row.type) &&
      byCategory.get(row.categoryId)?.type === row.type
    ) {
      baselineRows.push({
        id: row.id,
        type: row.type,
        currency: account.currencyCode,
        categoryId: row.categoryId,
        day: row.dateEpochDay,
      });
    }
    let reason;
    if (!modes.includes(row.type)) reason = 'transfer_or_unknown_type';
    else if (linked.has(row.id)) reason = 'linked_person_movement';
    else if (!category || category.type !== row.type)
      reason = 'missing_ambiguous_or_mismatched_category';
    else if (
      row.source === 'IMPORT' &&
      (row.type === 'EXPENSE' ? ['loan', 'repayment'] : ['debt', 'debt collection']).includes(
        asciiLower(category.name),
      )
    )
      reason = 'unlinked_imported_lending';
    else if (
      !account ||
      !/^[A-Z]{3}$/.test(account.currencyCode ?? '') ||
      !Number.isSafeInteger(row.dateEpochDay) ||
      Math.abs(row.dateEpochDay) > 100000000 ||
      !Number.isSafeInteger(row.amountMinor) ||
      row.amountMinor <= 0 ||
      !['IMPORT', 'MANUAL'].includes(row.source)
    )
      reason = 'missing_or_invalid_metadata';
    if (reason) increment(excluded, reason);
    else {
      increment(eligibleSources, source);
      rows.push({
        id: row.id,
        type: row.type,
        currency: account.currencyCode,
        accountId: row.accountId,
        categoryId: row.categoryId,
        amountMinor: row.amountMinor,
        day: row.dateEpochDay,
      });
    }
  }
  rows.sort((a, b) => a.day - b.day || a.id - b.id);
  return {
    rows,
    baselineRows,
    categories,
    provenance: {
      sha256: createHash('sha256').update(json).digest('hex'),
      schemaVersion: backup.schemaVersion,
      raw: {
        accounts: backup.accounts.length,
        categories: backup.categories.length,
        transactions: backup.transactions.length,
        lendingEntries: (backup.lendingEntries ?? []).length,
      },
      sources,
      eligibleSources,
      excluded,
      eligible: rows.length,
      eligibleDateRange: rows.length ? [date(rows[0].day), date(rows.at(-1).day)] : [],
    },
  };
}

export const defaultWeights = { halfLife: 90, accountBoost: 2, exact: 8, nearby: 3 };

export function rank(history, query, categories, method, weights = defaultWeights) {
  const candidates = categories.filter((category) => category.type === query.type);
  const stats = new Map(
    candidates.map((category) => [
      category.id,
      { count: 0, score: 0, day: -Infinity, id: -Infinity },
    ]),
  );
  for (const row of history) {
    if (row.day >= query.day || row.type !== query.type || row.currency !== query.currency)
      continue;
    const stat = stats.get(row.categoryId);
    if (!stat) continue;
    stat.count++;
    if (row.day > stat.day || (row.day === stat.day && row.id > stat.id)) {
      stat.day = row.day;
      stat.id = row.id;
    }
    if (method !== 'amount') continue;
    const distance =
      Math.abs(row.amountMinor - query.amountMinor) / Math.max(row.amountMinor, query.amountMinor);
    const similarity =
      distance === 0 ? weights.exact : weights.nearby * Math.max(0, 1 - distance / 0.1);
    stat.score +=
      2 ** (-(query.day - row.day) / weights.halfLife) *
      (row.accountId === query.accountId ? weights.accountBoost : 1) *
      (1 + similarity);
  }
  const recent = (a, b) => {
    const x = stats.get(a.id),
      y = stats.get(b.id);
    return (
      (y.day === x.day ? 0 : y.day > x.day ? 1 : -1) ||
      (y.id === x.id ? 0 : y.id > x.id ? 1 : -1) ||
      categoryTie(a, b)
    );
  };
  return candidates
    .sort((a, b) => {
      const x = stats.get(a.id),
        y = stats.get(b.id);
      return (
        (method === 'amount'
          ? y.score - x.score
          : method === 'frequency'
            ? y.count - x.count
            : 0) || recent(a, b)
      );
    })
    .map((category) => category.id);
}

export function replay(rows, categories, weights = defaultWeights, baselineRows = rows) {
  const dates = [...new Set(rows.map((row) => row.day))].sort((a, b) => a - b);
  if (dates.length < 2) throw new Error('At least two eligible dates are required');
  const splitDay = dates[Math.min(dates.length - 1, Math.floor(dates.length * 0.8))];
  const history = [];
  const metrics = {};
  for (let start = 0; start < rows.length;) {
    let end = start + 1;
    while (end < rows.length && rows[end].day === rows[start].day) end++;
    for (const query of rows.slice(start, end)) {
      const depth = history.filter(
        (row) => row.type === query.type && row.currency === query.currency,
      ).length;
      const phase = query.day < splitDay ? 'development' : 'final';
      const groups = [
        'all',
        `type:${query.type}`,
        `currency:${query.currency}`,
        `type-currency:${query.type}:${query.currency}`,
        `history:${depth === 0 ? '0' : depth < 10 ? '1-9' : depth < 100 ? '10-99' : '100+'}`,
      ];
      for (const method of ['recent', 'frequency', 'amount']) {
        const ranked = rank(
          method === 'recent' ? baselineRows : history,
          query,
          categories,
          method,
          weights,
        );
        for (const group of groups) {
          const key = `${phase}/${group}/${method}`;
          const metric = (metrics[key] ??= { n: 0, cold: 0, top1: 0, top3: 0 });
          metric.n++;
          metric.cold += Number(depth === 0);
          metric.top1 += Number(ranked[0] === query.categoryId);
          metric.top3 += Number(ranked.slice(0, 3).includes(query.categoryId));
        }
      }
    }
    history.push(...rows.slice(start, end));
    start = end;
  }
  return {
    split: {
      development: [date(dates[0]), date(dates[dates.indexOf(splitDay) - 1])],
      final: [date(splitDay), date(dates.at(-1))],
      eligibleDates: dates.length,
    },
    weights,
    metrics,
  };
}

export function evaluate(json) {
  const { rows, baselineRows, categories, provenance } = adaptBackup(json);
  return { provenance, ...replay(rows, categories, defaultWeights, baselineRows) };
}

export function chart(result) {
  const methods = ['recent', 'frequency', 'amount'];
  const bars = methods
    .map((method, index) => {
      const metric = result.metrics[`final/all/${method}`];
      const rate = (100 * metric.top1) / metric.n;
      return `<text x="20" y="${70 + index * 55}" font-size="16">${method}</text><rect x="125" y="${50 + index * 55}" width="${rate * 5}" height="28" fill="#247655"/><text x="${135 + rate * 5}" y="${70 + index * 55}" font-size="16">${rate.toFixed(2)}%</text>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="270" viewBox="0 0 760 270"><rect width="760" height="270" fill="white"/><g font-family="sans-serif" fill="#172b24"><text x="20" y="28" font-size="20">Final holdout: Category top-1 accuracy</text>${bars}<text x="20" y="235" font-size="14">All eligible examples, including cold starts. Fixed amount ranker; no holdout tuning.</text></g></svg>\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output, chartPath] = process.argv.slice(2);
  if (!input || !output || !chartPath || new Set([input, output, chartPath]).size !== 3) {
    throw new Error(
      'Usage: node scripts/category-prediction.mjs INPUT.json OUTPUT.json CHART.svg (distinct paths)',
    );
  }
  const result = evaluate(readFileSync(input, 'utf8'));
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  writeFileSync(chartPath, chart(result), { flag: 'wx' });
}
