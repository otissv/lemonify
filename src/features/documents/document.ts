import type { Pipeline } from '@/features/pipeline/pipeline'

export const MAX_DOCUMENT_NAME_LENGTH = 80

/** What the browser needs to know about a Source; the file itself is fetched by id. */
export type SourceSummary = {
  id: string
  fileName: string
  mediaType: string
  bytes: number
  width: number
  height: number
}

/** A Document as the editor works with it: its Pipeline and whether History can undo or redo. */
export type DocumentView = {
  id: string
  name: string
  source: SourceSummary
  pipeline: Pipeline
  /** Changes must name the revision they were made on, so two tabs never overwrite each other. */
  revision: number
  canUndo: boolean
  canRedo: boolean
  createdAt: string
  updatedAt: string
}

/** One row of the list of open images. */
export type DocumentSummary = {
  id: string
  name: string
  source: SourceSummary
  revision: number
  updatedAt: string
}
