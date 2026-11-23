/** Evaluate basic arithmetic and round the final result to currency precision. */
export function calculateAmount(expression: string, precision = 2): string {
  const source = expression
    .replace(/\s/g, '')
    .replaceAll('×', '*')
    .replaceAll('÷', '/')
    .replaceAll('−', '-');
  const tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+)|[+*/-]/g) ?? [];
  if (!source || tokens.join('') !== source) throw new Error('Enter a complete calculation.');
  let index = 0;
  function number(): number {
    const sign = tokens[index] === '-' ? (index++, -1) : 1;
    const token = tokens[index++];
    if (!token || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token))
      throw new Error('Enter a complete calculation.');
    return sign * Number(token);
  }
  function term(): number {
    let value = number();
    while (tokens[index] === '*' || tokens[index] === '/') {
      const operator = tokens[index++];
      const right = number();
      if (operator === '/' && right === 0) throw new Error('Cannot divide by zero.');
      value = operator === '*' ? value * right : value / right;
    }
    return value;
  }
  let value = term();
  while (index < tokens.length) {
    const operator = tokens[index++];
    if (operator !== '+' && operator !== '-') throw new Error('Enter a complete calculation.');
    const right = term();
    value = operator === '+' ? value + right : value - right;
  }
  const minor = Math.round((value + Number.EPSILON * Math.abs(value)) * 10 ** precision);
  if (!Number.isSafeInteger(minor)) throw new Error('Result is outside the supported range.');
  return (minor / 10 ** precision).toFixed(precision);
}

/** The text in the amount keypad, with the state that the next key depends on. */
export type AmountEntry = {
  amount: string;
  /** The amount is the result of the equals key. The next digit starts a new amount. */
  evaluated: boolean;
  /** The message from the last equals key that failed. */
  error: string;
};

/**
 * Return the entry after one keypad key. Pass this to a state setter as an update function.
 * `precision` is the number of decimal places that the equals key keeps.
 */
export function pressAmountKey(entry: AmountEntry, key: string, precision = 2): AmountEntry {
  const { amount } = entry;
  if (key === '=') {
    try {
      return { amount: calculateAmount(amount, precision), evaluated: true, error: '' };
    } catch (cause) {
      return { amount, evaluated: entry.evaluated, error: (cause as Error).message };
    }
  }
  let next: string;
  if (key === 'C') next = '';
  else if (key === '⌫') next = amount.slice(0, -1);
  else if (entry.evaluated && /^(?:[0-9.]|00)$/.test(key)) next = key;
  else next = amount + key;
  if (['+', '−', '×', '÷'].includes(key) && /[+−×÷]$/.test(amount))
    next = amount.slice(0, -1) + key;
  return { amount: next, evaluated: false, error: '' };
}
