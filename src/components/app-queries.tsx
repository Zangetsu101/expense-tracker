import { useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { focusManager, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { createQueryClient } from '@/lib/query-client';
import { QueryTimeContext } from '@/lib/query-time';

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
    // A write can cross midnight. Take the time again after each successful mutation.
    const unsubscribe = client.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'success') setNow(new Date());
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
