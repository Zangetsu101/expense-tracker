export type SplitShare = { personId: number; amountMinor: number };

export function splitShares(
  total: number,
  people: readonly number[],
  fixed: Readonly<Partial<Record<number, number>>>,
) {
  const remaining = total - people.reduce((sum, id) => sum + (fixed[id] ?? 0), 0);
  const count = 1 + people.filter((id) => fixed[id] === undefined).length;
  const available = Math.max(0, remaining);
  const even = Math.floor(available / count);
  let extra = Math.max(0, (available % count) - 1);
  const shares = people.map((personId) => {
    const amountMinor = fixed[personId] ?? (extra > 0 ? even + 1 : even);
    if (fixed[personId] === undefined && extra > 0) extra -= 1;
    return { personId, amountMinor };
  });
  return { shares, yours: total - shares.reduce((sum, share) => sum + share.amountMinor, 0) };
}

export function reimbursementTitle(name: string | null | undefined) {
  return name ? `Reimbursement from ${name}` : 'Refund';
}
