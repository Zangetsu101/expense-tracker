import type { MoneyLoverRow } from './csv';

export type TransferPair = { outgoing: MoneyLoverRow; incoming: MoneyLoverRow };
export type TransferMatches = {
  highConfidence: TransferPair[];
  uncertain: TransferPair[];
  /** Rows not auto-merged, including rows involved in review candidates. */
  singleSided: MoneyLoverRow[];
};

const outgoingCategories = new Set(['withdrawal', 'outgoing transfer']);
const incomingCategories = new Set(['deposit', 'incoming transfer']);

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function corroborated(out: MoneyLoverRow, inc: MoneyLoverRow): boolean {
  const outCategory = normalized(out.category);
  const inCategory = normalized(inc.category);
  const destination = normalized(inc.account);
  const source = normalized(out.account);
  const outNote = normalized(out.note);
  const inNote = normalized(inc.note);
  return (
    (outgoingCategories.has(outCategory) ||
      incomingCategories.has(inCategory) ||
      outCategory === 'transfer' ||
      inCategory === 'transfer') &&
    (['send to', 'sent to', 'transfer to', 'move to'].some(
      (phrase) => outNote === `${phrase} ${destination}`,
    ) ||
      ['from', 'received from', 'transfer from'].some((phrase) => inNote === `${phrase} ${source}`))
  );
}

/** Classify plausible same-currency MoneyLover transfer legs without resolving ambiguous matches. */
export function classifyTransferPairs(rows: MoneyLoverRow[]): TransferMatches {
  const candidates: {
    outgoingIndex: number;
    incomingIndex: number;
    pair: TransferPair;
    strong: boolean;
  }[] = [];
  const degree = new Array<number>(rows.length).fill(0);
  const incoming = new Map<string, number[]>();
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (!(row.amount > 0) || !Number.isFinite(row.amount)) continue;
    const key = JSON.stringify([row.date, row.amount, normalized(row.currency)]);
    const matches = incoming.get(key) ?? [];
    matches.push(index);
    incoming.set(key, matches);
  }
  for (let i = 0; i < rows.length; i++) {
    const out = rows[i];
    if (!(out.amount < 0) || !Number.isFinite(out.amount)) continue;
    const key = JSON.stringify([out.date, -out.amount, normalized(out.currency)]);
    for (const j of incoming.get(key) ?? []) {
      const inc = rows[j];
      if (normalized(inc.account) === normalized(out.account)) continue;
      candidates.push({
        outgoingIndex: i,
        incomingIndex: j,
        pair: { outgoing: out, incoming: inc },
        strong: corroborated(out, inc),
      });
      degree[i]++;
      degree[j]++;
    }
  }
  const highConfidence: TransferPair[] = [];
  const uncertain: TransferPair[] = [];
  const merged = new Set<number>();
  for (const candidate of candidates) {
    if (
      candidate.strong &&
      degree[candidate.outgoingIndex] === 1 &&
      degree[candidate.incomingIndex] === 1
    ) {
      highConfidence.push(candidate.pair);
      merged.add(candidate.outgoingIndex);
      merged.add(candidate.incomingIndex);
    } else {
      uncertain.push(candidate.pair);
    }
  }
  return { highConfidence, uncertain, singleSided: rows.filter((_, index) => !merged.has(index)) };
}
