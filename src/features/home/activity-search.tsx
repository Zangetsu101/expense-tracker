import { View } from 'react-native';
import { router } from 'expo-router';
import { accountParams } from '@/lib/account-selection';
import { epochDay } from '@/lib/database';
import { SearchField } from './list-view.tsx';
import { searchPlaceholder } from './list.ts';
import { homePeriod, type PeriodSetting } from './period.ts';

export function ActivitySearch({
  accountId,
  setting,
  now,
  value,
  onChange,
}: {
  accountId: number | null;
  setting: PeriodSetting;
  now: Date;
  value: string;
  onChange: (text: string) => void;
}) {
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 6 }}>
      <SearchField
        value={value}
        placeholder={searchPlaceholder(setting, homePeriod(setting, epochDay(now)).label)}
        onChange={onChange}
        onOpenFilters={() =>
          router.push({
            pathname: '/transactions',
            params: {
              ...accountParams(accountId),
              ...(value.trim() ? { query: value.trim() } : {}),
            },
          })
        }
      />
    </View>
  );
}
