/** Parsed MoneyLover export row. Amount is signed; date is a local calendar day (YYYY-MM-DD). */
export type MoneyLoverRow = {
  sourceId: string;
  note: string;
  amount: number;
  category: string;
  account: string;
  currency: string;
  date: string;
  excludeFromReport: boolean;
};

/** Split CSV records, preserving newlines inside quoted fields and unescaping doubled quotes. */
function splitRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      record.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (field || record.length) {
        record.push(field);
        records.push(record);
        record = [];
        field = '';
      }
      if (char === '\r' && text[i + 1] === '\n') i++;
    } else {
      field += char;
    }
  }
  if (field || record.length) records.push([...record, field]);
  return records;
}

function parseDate(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (year < 1 || !days || day < 1 || day > days) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

/**
 * Parse UTF-8 MoneyLover CSV text. First record is treated as the header, as in the
 * Android importer. Invalid/short rows are skipped; the Event column is unused.
 * This only parses: it does not persist, infer categories, or reconstruct transfers.
 */
export function parseMoneyLoverCsv(text: string): MoneyLoverRow[] {
  const records = splitRecords(text.replace(/^\uFEFF/, ''));
  return records.slice(1).flatMap((columns) => {
    if (columns.length < 9) return [];
    const amountText = columns[2].trim();
    const amount = Number(amountText);
    const date = parseDate(columns[6].trim());
    if (!amountText || !Number.isFinite(amount) || date === null) return [];
    return [{
      sourceId: columns[0].trim(),
      note: columns[1].trim(),
      amount,
      category: columns[3].trim(),
      account: columns[4].trim(),
      currency: columns[5].trim(),
      date,
      excludeFromReport: columns[8].trim().toLowerCase() === 'true',
    }];
  });
}
