/** The text of an error for the user, without the "Error:" prefix. */
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
