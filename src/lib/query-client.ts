import { MutationCache, QueryClient } from '@tanstack/react-query';

/** A write that asks for a confirmation first has not changed the data. */
function committed(result: unknown) {
  return !(
    typeof result === 'object' &&
    result !== null &&
    'status' in result &&
    result.status === 'confirmation_required'
  );
}

export function createQueryClient() {
  const client: QueryClient = new QueryClient({
    // Each committed write makes all queries read again. Thus all writes of the screens
    // must go through useMutation. This runs before the onSuccess of the mutation itself,
    // so the queries already fetch when the mutation is no longer pending.
    mutationCache: new MutationCache({
      onSuccess: (result) => {
        if (committed(result)) void client.invalidateQueries();
      },
    }),
    defaultOptions: {
      queries: {
        networkMode: 'always',
        retry: false,
        refetchOnWindowFocus: true,
        refetchOnReconnect: false,
      },
      // The writes go to SQLite on the device. They must also run without a network.
      mutations: { networkMode: 'always' },
    },
  });
  return client;
}
