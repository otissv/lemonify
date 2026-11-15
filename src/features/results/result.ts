/** What the browser may know about a Result; the image itself is downloaded by id. */
export type ResultView = {
  id: string
  kind: 'ai-step' | 'export' | 'run-item'
  fileName: string
  mediaType: string
  bytes: number
  documentId: string | null
  stepId: string | null
  workflowRunId: string | null
  createdAt: string
}

/** How much of the User's Result storage is used. */
export type ResultUsage = {
  usedBytes: number
  maxBytes: number
}

export function resultUrl(id: string): string {
  return `/api/results/${encodeURIComponent(id)}`
}
