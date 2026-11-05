// THROWAWAY: account treatments within the same A composer; selection stays inline.
import { Pressable, Text, View } from 'react-native';
import type { Account } from '@/lib/database';
import { Chip, Row, c } from './shared';

export type AccountTreatment = 'filled' | 'compact' | 'tiles' | 'before';
export function AccountOptions({ accounts, selectedId, onSelect, treatment }: { accounts: Account[]; selectedId?: number; onSelect: (id: number) => void; treatment: AccountTreatment }) {
  if (treatment === 'before') return <Row>{accounts.map((account) => <Chip key={account.id} label={`${account.name}${account.isFavorite ? ' ★' : ''}`} sub={account.currencyCode} selected={account.id === selectedId} onPress={() => onSelect(account.id)} />)}</Row>;
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
    {accounts.map((account) => {
      const selected = account.id === selectedId;
      const compact = treatment === 'compact';
      const tile = treatment === 'tiles';
      const ink = selected ? c.background : c.text;
      return <Pressable key={account.id} accessibilityRole="button" accessibilityLabel={`${account.name}, ${account.currencyCode}${account.isFavorite ? ', favorite' : ''}`} accessibilityState={{ selected }} onPress={() => onSelect(account.id)} style={({ pressed }) => ({
        ...(tile ? { width: '48%' as const, flexGrow: 1 } : {}),
        minHeight: compact ? 48 : tile ? 90 : 68,
        paddingHorizontal: compact ? 14 : 16, paddingVertical: compact ? 10 : 12,
        borderRadius: compact ? 999 : 14, borderCurve: 'continuous',
        backgroundColor: selected ? c.accent : c.raised,
        opacity: pressed ? 0.7 : 1,
        gap: tile ? 12 : 4,
        justifyContent: 'center',
      })}>
        {tile ? <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: ink, fontSize: 12, fontWeight: '600' }}>{account.currencyCode}{account.isFavorite ? ' · Favorite' : ''}</Text>
            <Text style={{ color: ink, fontSize: 16 }}>{selected ? '●' : '○'}</Text>
          </View>
          <Text style={{ color: ink, fontSize: 17, fontWeight: '700' }}>{account.name}</Text>
        </> : <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: ink, fontSize: 15, fontWeight: selected ? '700' : '500' }}>{account.name}{account.isFavorite ? ' ★' : ''}</Text>
            {selected && <Text style={{ color: ink, fontWeight: '700' }}>✓</Text>}
            {compact && <Text style={{ color: selected ? c.background : c.muted, fontSize: 11 }}>{account.currencyCode}</Text>}
          </View>
          {!compact && <Text style={{ color: selected ? c.background : c.muted, fontSize: 12 }}>{account.currencyCode}</Text>}
        </>}
      </Pressable>;
    })}
  </View>;
}
