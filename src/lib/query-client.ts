import { QueryClient } from '@tanstack/react-query';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: 'always',
        retry: false,
        refetchOnWindowFocus: true,
        refetchOnReconnect: false,
      },
    },
  });
}
