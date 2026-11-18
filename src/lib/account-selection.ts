/** Reads a positive integer ID, such as an Account ID or a person ID, from a route param. */
export function parseRouteId(value: string | string[] | undefined): number | undefined {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : undefined;
}

/** Route params that name an Account, or no params for All accounts. */
export function accountParams(accountId: number | null): { accountId?: string } {
  return accountId === null ? {} : { accountId: String(accountId) };
}
