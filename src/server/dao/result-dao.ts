export const ResultKind = {
  AiStep: 'ai-step',
  Export: 'export',
  RunItem: 'run-item',
} as const

export type ResultKind = (typeof ResultKind)[keyof typeof ResultKind]

export type ResultRecord = {
  id: string
  ownerId: string
  kind: ResultKind
  /** Names the stored file; for an AI Step it is the render key of the Pipeline up to that Step. */
  key: string
  documentId: string | null
  stepId: string | null
  workflowRunId: string | null
  fileName: string
  mediaType: string
  bytes: number
  createdAt: string
}

export type ResultFilter = {
  documentId?: string
  workflowRunId?: string
  kind?: ResultKind
}

export interface ResultDao {
  insert(result: ResultRecord): Promise<void>
  findById(id: string): Promise<ResultRecord | null>
  /** The User's Result stored under a key, if any; an AI Step is "out of date" exactly when there is none. */
  findByKey(ownerId: string, key: string): Promise<ResultRecord | null>
  /** Newest first. */
  list(ownerId: string, filter: ResultFilter): Promise<ResultRecord[]>
  delete(id: string): Promise<void>
  /** Removes every Result of a Document. */
  deleteForDocument(documentId: string): Promise<void>
  /** How many Results, of any User, share a key (and so a file). */
  countByKey(key: string): Promise<number>
  sumBytes(ownerId: string): Promise<number>
}
