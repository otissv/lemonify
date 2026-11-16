import type { HistoryPatch } from '@/features/pipeline/document-change'
import type { Pipeline } from '@/features/pipeline/pipeline'

export const STALE_DOCUMENT_MESSAGE =
  'This image was changed somewhere else. Reload it to see the latest version.'

export type DocumentRecord = {
  id: string
  ownerId: string
  name: string
  pipeline: Pipeline
  revision: number
  /** The position the next change will take; entries below it are applied. */
  historyCursor: number
  createdAt: string
  updatedAt: string
}

export type HistoryEntryRecord = {
  documentId: string
  position: number
  patch: HistoryPatch
  createdAt: string
}

export type RecordedChange = {
  id: string
  expectedRevision: number
  pipeline: Pipeline
  operandSourceIds: string[]
  patch: HistoryPatch
  maxEntries: number
  now: string
}

export type MovedCursor = {
  id: string
  expectedRevision: number
  pipeline: Pipeline
  operandSourceIds: string[]
  cursor: number
  now: string
}

/**
 * Every method is one whole operation. The ones that change a Document check
 * its revision and fail with a ConflictError if it moved, so two tabs never
 * overwrite each other.
 */
export interface DocumentDao {
  /** Stores the Document and links the Sources its Pipeline uses, in one transaction. */
  insert(document: DocumentRecord, sourceIds: string[]): Promise<void>
  findById(id: string): Promise<DocumentRecord | null>
  /** Most recently changed first. */
  listByOwner(ownerId: string): Promise<DocumentRecord[]>
  rename(id: string, name: string, now: string): Promise<DocumentRecord>
  /** Removes the Document, its History and its operand links. */
  delete(id: string): Promise<void>
  /**
   * Writes the new Pipeline, drops the undone entries, records the patch at the
   * cursor, trims the oldest entries beyond `maxEntries`, links the operand
   * Sources and raises the revision, all in one transaction.
   */
  applyChange(change: RecordedChange): Promise<DocumentRecord>
  /** Writes the Pipeline an undo or redo produced and moves the cursor. */
  moveCursor(move: MovedCursor): Promise<DocumentRecord>
  findEntry(
    documentId: string,
    position: number,
  ): Promise<HistoryEntryRecord | null>
  /** Documents whose Pipeline uses the Source, as an opened image or a second image. */
  listBySource(sourceId: string): Promise<DocumentRecord[]>
}
