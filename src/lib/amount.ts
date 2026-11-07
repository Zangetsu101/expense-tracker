export function parsePositiveAmountMinor(value: string): number {
  const match = /^(?:0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error('Enter a positive amount with at most two decimal places.');
  const [whole] = value.trim().split('.');
  const minor = Number(whole) * 100 + Number((match[1] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(minor) || minor <= 0)
    throw new Error('Enter a positive amount within the supported range.');
  return minor;
}
