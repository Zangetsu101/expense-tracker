import { useState } from 'react';
import { Text, View } from 'react-native';
import { FormButton } from '@/components/form-controls';
import { calculateAmount } from '@/lib/amount-calculator';
import { theme } from '@/theme';

const rows = [['C', '⌫', '÷', '×'], ['7', '8', '9', '−'], ['4', '5', '6', '+'], ['1', '2', '3', '='], ['0', '.']];

export function AmountCalculator({ initialAmount, onUse, onCancel }: {
  initialAmount: string; onUse: (amount: string) => void; onCancel: () => void;
}) {
  const [expression, setExpression] = useState(initialAmount);
  const [error, setError] = useState('');
  const [evaluated, setEvaluated] = useState(false);
  function evaluate(use: boolean) {
    try {
      const result = calculateAmount(expression);
      if (use && Number(result) <= 0) throw new Error('Use a positive amount.');
      setExpression(result);
      setEvaluated(true);
      setError('');
      if (use) onUse(result);
    } catch (cause) { setError((cause as Error).message); }
  }
  return <View style={{ gap: 8 }}>
    <Text accessibilityLabel="Calculation" selectable style={{ color: theme.colors.text, fontSize: 26, fontVariant: ['tabular-nums'], textAlign: 'right' }}>{expression || '0'}</Text>
    {rows.map((row, index) => <View key={index} style={{ flexDirection: 'row', gap: 8 }}>
      {row.map((key) => <FormButton key={key} label={key} accessibilityLabel={key === '⌫' ? 'Backspace' : key === 'C' ? 'Clear calculation' : key} style={{ flex: 1 }} onPress={() => {
        if (key === '=') { evaluate(false); return; }
        setError('');
        setExpression((current) => key === 'C' ? '' : key === '⌫' ? current.slice(0, -1) : evaluated && /^[0-9.]$/.test(key) ? key : current + key);
        setEvaluated(false);
      }} />)}
    </View>)}
    {!!error && <Text accessibilityRole="alert" style={{ color: theme.colors.warning }}>{error}</Text>}
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <FormButton label="Cancel calculator" onPress={onCancel} style={{ flex: 1 }} />
      <FormButton label="Use amount" variant="primary" onPress={() => evaluate(true)} style={{ flex: 1 }} />
    </View>
  </View>;
}
