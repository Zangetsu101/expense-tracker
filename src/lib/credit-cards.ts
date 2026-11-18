import { database, epochDay } from './database.ts';

export type CreditCardSettings = {
  accountId: number;
  parentAccountId: number | null;
  statementDay: number | null;
  dueDay: number | null;
};
export type CardMovement = { date: number; changeMinor: number };
export type CardBill = CreditCardSettings & {
  billMinor: number;
  owedMinor: number;
  unbilledMinor: number;
  creditMinor: number;
  statementDate: number | null;
  dueDate: number | null;
  overdue: boolean;
};

function monthDay(year: number, month: number, day: number) {
  const last = new Date(year, month + 1, 0).getDate();
  return epochDay(new Date(year, month, Math.min(day, last)));
}

export function calculateCardBill(
  settings: CreditCardSettings,
  openingBalanceMinor: number,
  movements: CardMovement[],
  today: number,
): CardBill {
  const now = new Date(today * 86400000);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  let statementDate = settings.statementDay ? monthDay(year, month, settings.statementDay) : null;
  if (statementDate !== null && statementDate > today)
    statementDate = monthDay(year, month - 1, settings.statementDay!);
  let balance = openingBalanceMinor;
  let statementBalance = openingBalanceMinor;
  let payments = 0;
  for (const movement of movements) {
    if (movement.date > today) continue;
    balance += movement.changeMinor;
    if (statementDate !== null && movement.date <= statementDate)
      statementBalance += movement.changeMinor;
    else if (movement.changeMinor > 0) payments += movement.changeMinor;
  }
  const owedMinor = Math.max(0, -balance);
  const billMinor =
    statementDate === null
      ? owedMinor
      : Math.min(owedMinor, Math.max(0, -statementBalance - payments));
  let dueDate: number | null = null;
  if (settings.dueDay) {
    const anchor = new Date((statementDate ?? today) * 86400000);
    dueDate = monthDay(anchor.getUTCFullYear(), anchor.getUTCMonth(), settings.dueDay);
    if (statementDate !== null && dueDate <= statementDate)
      dueDate = monthDay(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, settings.dueDay);
  }
  return {
    ...settings,
    billMinor,
    owedMinor,
    unbilledMinor: owedMinor - billMinor,
    creditMinor: Math.max(0, balance),
    statementDate,
    dueDate,
    overdue: billMinor > 0 && dueDate !== null && today > dueDate,
  };
}

export async function creditCardBills(today = epochDay(new Date())): Promise<CardBill[]> {
  const db = await database();
  const settings = await db.getAllAsync<CreditCardSettings & { openingBalanceMinor: number }>(
    'SELECT c.*, a.openingBalanceMinor FROM credit_cards c JOIN accounts a ON a.id = c.accountId',
  );
  if (!settings.length) return [];
  const movements = await db.getAllAsync<{ accountId: number; date: number; changeMinor: number }>(
    `SELECT a.id AS accountId, t.date, CASE
      WHEN t.type = 'EXPENSE' OR (t.type = 'TRANSFER' AND t.accountId = a.id) THEN -t.amountMinor
      ELSE COALESCE(t.receivedAmountMinor, t.amountMinor) END AS changeMinor
    FROM credit_cards c JOIN accounts a ON a.id = c.accountId
    JOIN transactions t ON t.accountId = a.id OR (t.type = 'TRANSFER' AND t.transferAccountId = a.id)
    WHERE t.date <= ?`,
    [today],
  );
  return settings.map(({ openingBalanceMinor, ...card }) =>
    calculateCardBill(
      card,
      openingBalanceMinor,
      movements.filter((row) => row.accountId === card.accountId),
      today,
    ),
  );
}
