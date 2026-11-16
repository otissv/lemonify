/** The reason in an API answer shaped `{ data: [], error }`, or `fallback` when the answer is anything else. */
export async function readErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body: unknown = await response.json()
    if (
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'string' &&
      body.error !== ''
    ) {
      return body.error
    }
  } catch {
    // Not the shape the server answers with; the fallback says it.
  }
  return fallback
}
