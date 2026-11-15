/** The message of a caught error, or `fallback` when there is none to show. */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
