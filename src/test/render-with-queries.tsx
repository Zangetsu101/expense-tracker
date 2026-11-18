import type { ReactElement } from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, render } from '@testing-library/react-native';
import { AppQueryLifecycle } from '@/components/app-queries';
import { createQueryClient } from '@/lib/query-client';

const clients: QueryClient[] = [];
// Clear each cache after its test. If not, the cache timers keep Jest running.
afterEach(async () => {
  await act(async () => {
    for (const client of clients.splice(0)) client.clear();
  });
});

/**
 * Renders a screen with the app query lifecycle, using a fresh client by default.
 * A call to notifyDataChanged() then refreshes the queries, as in the app.
 */
export async function renderWithQueries(ui: ReactElement, client = createQueryClient()) {
  clients.push(client);
  const view = await render(
    <QueryClientProvider client={client}>
      <AppQueryLifecycle>{ui}</AppQueryLifecycle>
    </QueryClientProvider>,
  );
  return { ...view, client };
}
