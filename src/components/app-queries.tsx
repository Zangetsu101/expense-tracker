import { useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { focusManager, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { createQueryClient } from '@/lib/query-client';
import { QueryTimeContext } from '@/lib/query-time';
import { invalidateHome } from '@/features/home';
import { subscribeDataChanges } from '@/lib/data-changes';

export function AppQueryLifecycle({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let previous = AppState.currentState;
    const lifecycle = AppState.addEventListener('change', (next) => {
      if (next !== 'inactive') focusManager.setFocused(next === 'active');
      if (next === 'active' && previous === 'background') {
        setNow(new Date());
      }
      if (next !== 'inactive') previous = next;
    });
    // Bridge committed SQLite writes to the query cache until mutation onSuccess handlers own invalidation.
    const unsubscribe = subscribeDataChanges(() => {
      setNow(new Date());
      void invalidateHome(client);
    });
    return () => {
      lifecycle.remove();
      unsubscribe();
      focusManager.setFocused(undefined);
    };
  }, [client]);
  return <QueryTimeContext value={now}>{children}</QueryTimeContext>;
}

export function AppQueriesProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      <AppQueryLifecycle>{children}</AppQueryLifecycle>
    </QueryClientProvider>
  );
}
