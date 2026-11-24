/** Starts every read at once and gives an object with the same keys and the results. */
export async function readAll<T extends Record<string, Promise<unknown>>>(
  reads: T,
): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
  const entries = await Promise.all(
    Object.entries(reads).map(async ([key, read]) => [key, await read] as const),
  );
  return Object.fromEntries(entries) as { [K in keyof T]: Awaited<T[K]> };
}
