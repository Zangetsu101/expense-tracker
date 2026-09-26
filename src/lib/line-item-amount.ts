export function parseLineItemAmount(text: string): number {
  const match = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) throw new Error('Enter a Line Item amount with at most two decimal places.');
  const magnitude = Number(match[2]) * 100 + Number((match[3] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(magnitude)) throw new Error('Line Item amount is too large.');
  return match[1] === '-' ? -magnitude : magnitude;
}

export function formatLineItemAmount(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor)) throw new Error('Unsupported Line Item amount.');
  const magnitude = Math.abs(amountMinor);
  return `${amountMinor < 0 ? '-' : ''}${Math.floor(magnitude / 100)}.${String(magnitude % 100).padStart(2, '0')}`;
}
