export type CategoryEvidence = {
  categoryId: number;
  accountId: number;
  amountMinor: number;
  day: number;
};

export function categoryContribution(
  row: CategoryEvidence,
  amountMinor: number,
  accountId: number,
  day: number,
) {
  const distance = Math.abs(row.amountMinor - amountMinor) / Math.max(row.amountMinor, amountMinor);
  const affinity = distance === 0 ? 8 : 3 * Math.max(0, 1 - distance / 0.1);
  return 2 ** (-(day - row.day) / 90) * (row.accountId === accountId ? 2 : 1) * (1 + affinity);
}

// Input order supplies the existing recent-first fallback, including score ties.
export function rankCategoryIds(
  ids: number[],
  history: CategoryEvidence[],
  amountMinor: number,
  accountId: number,
  day: number,
) {
  const scores = new Map(ids.map((id) => [id, 0]));
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return ids;
  for (const row of history) {
    if (row.day > day || !scores.has(row.categoryId)) continue;
    scores.set(
      row.categoryId,
      scores.get(row.categoryId)! + categoryContribution(row, amountMinor, accountId, day),
    );
  }
  return [...ids].sort((a, b) => scores.get(b)! - scores.get(a)!);
}
