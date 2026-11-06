import { useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { focusManager, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { createQueryClient } from '@/lib/query-client';
import { QuerySessionContext } from '@/lib/query-session';
import { homeQueryKey } from '@/lib/home-queries';
import { subscribeDataChanges } from '@/lib/data-changes';

export function AppQueryLifecycle({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [session, setSession] = useState(() => ({ id: 0, now: new Date() }));
  useEffect(() => {
    let previous = AppState.currentState;
    const lifecycle = AppState.addEventListener('change', (next) => {
      if (next !== 'inactive') focusManager.setFocused(next === 'active');
      if (next === 'active' && previous === 'background') {
        setSession((value) => ({ id: value.id + 1, now: new Date() }));
      }
      if (next !== 'inactive') previous = next;
    });
    const unsubscribe = subscribeDataChanges(() => {
      setSession((value) => ({ ...value, now: new Date() }));
      void client.invalidateQueries({ queryKey: homeQueryKey });
    });
    return () => {
      lifecycle.remove();
      unsubscribe();
    };
  }, [client]);
  return <QuerySessionContext value={session}>{children}</QuerySessionContext>;
}

export function AppQueriesProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      <AppQueryLifecycle>{children}</AppQueryLifecycle>
    </QueryClientProvider>
  );
}
