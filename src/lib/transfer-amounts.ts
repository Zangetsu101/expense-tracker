import type { DisplayRate } from './display-rate.ts';

export type TransferAmounts = {
  pay?: number;
  receive?: number;
  rate?: number;
  base: string;
  quote: string;
  typed: { pay: boolean; receive: boolean };
};
export type TransferField = 'pay' | 'receive' | 'rate';
export type LastTransferRate = {
  paid: number;
  received: number;
  source: string;
  destination: string;
  date: number;
};

export function savedTransferRate(transfer: Omit<LastTransferRate, 'date'>) {
  const forward = transfer.received >= transfer.paid;
  return {
    base: forward ? transfer.source : transfer.destination,
    quote: forward ? transfer.destination : transfer.source,
    rate: forward ? transfer.received / transfer.paid : transfer.paid / transfer.received,
  };
}

export function firstTransferRate(
  source: string,
  destination: string,
  display: DisplayRate | null,
  last: LastTransferRate | null,
) {
  if (
    display &&
    [source, destination].includes(display.base) &&
    [source, destination].includes(display.quote)
  )
    return { base: display.base, quote: display.quote, rate: display.rate };
  if (last) return { ...savedTransferRate(last), date: last.date };
  return { base: destination, quote: source, rate: undefined };
}

export function applyTransferAmount(
  state: TransferAmounts,
  field: TransferField,
  value: number | undefined,
  source: string,
): TransferAmounts {
  const next = { ...state, typed: { ...state.typed }, [field]: value };
  if (field !== 'rate') next.typed[field] = value !== undefined;
  const follow = (target: TransferField) => {
    if (target === 'rate') {
      if (!next.pay || !next.receive) return false;
      next.rate = source === next.base ? next.receive / next.pay : next.pay / next.receive;
    } else {
      const other = target === 'pay' ? next.receive : next.pay;
      if (!other || !next.rate) return false;
      const multiply = target === 'pay' ? source === next.quote : source === next.base;
      const minor = Math.round(multiply ? other * next.rate : other / next.rate);
      next[target] = Number.isSafeInteger(minor) && minor > 0 ? minor : undefined;
    }
    return true;
  };
  const other = field === 'pay' ? 'receive' : 'pay';
  let target: TransferField;
  if (field === 'rate') target = next.typed.receive || !next.typed.pay ? 'pay' : 'receive';
  else target = next.typed[other] && next[other] ? 'rate' : other;
  if (value !== undefined && !follow(target)) {
    const fallback = (['pay', 'receive', 'rate'] as const).find(
      (key) => key !== field && key !== target,
    )!;
    follow(fallback);
  }
  return next;
}

export function formatTransferRate(rate: number) {
  return rate.toFixed(4).replace(/0{1,2}$/, '');
}
