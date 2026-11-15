/** The documents opened in this browser tab, oldest first; the last is the one on screen. */
export type DocumentHistory = ReadonlyArray<string>

export function visitInHistory(
  history: DocumentHistory,
  documentId: string,
): DocumentHistory {
  return [...history.filter((id) => id !== documentId), documentId]
}

export function closeInHistory(
  history: DocumentHistory,
  documentId: string,
): DocumentHistory {
  return history.filter((id) => id !== documentId)
}

/**
 * Where closing a document goes: the one opened most recently before it that
 * still exists, or undefined when there is none (the welcome page).
 */
export function previousDocumentId(
  history: DocumentHistory,
  closing: string,
  existing: ReadonlyArray<string>,
): string | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const id = history[index]
    if (id !== undefined && id !== closing && existing.includes(id)) return id
  }
  return undefined
}
