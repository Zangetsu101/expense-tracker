import type { ReactElement } from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import { AppQueryLifecycle } from '@/components/app-queries';
import { createQueryClient } from '@/lib/query-client';

const clients: QueryClient[] = [];
// Clear each cache after its test. If not, the cache timers keep Jest running.
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
});

/**
 * Renders a screen with a new query client and the app query lifecycle.
 * A call to notifyDataChanged() then refreshes the queries, as in the app.
 */
export async function renderWithQueries(ui: ReactElement) {
  const client = createQueryClient();
  // A finished mutation starts a cache timer that clear() does not stop. Start no timer.
  client.setDefaultOptions({
    ...client.getDefaultOptions(),
    mutations: { ...client.getDefaultOptions().mutations, gcTime: Infinity },
  });
  clients.push(client);
  const view = await render(
    <QueryClientProvider client={client}>
      <AppQueryLifecycle>{ui}</AppQueryLifecycle>
    </QueryClientProvider>,
  );
  return { ...view, client };
}
