import type { DocumentView } from '@/features/documents/document'

import type { ImageInspector } from '../tools/image-inspector.ts'
import type { DocumentDao } from '../dao/document-dao.ts'
import type { Logger } from '../http/logger.ts'
import type { DocumentPlanner } from '../render/document-planner.ts'
import type { DocumentService } from './document-service.ts'
import type { ResultService } from './result-service.ts'
import type { SourceService } from './source-service.ts'

export type DocumentBundleServiceDependencies = {
  documents: DocumentDao
  documentService: DocumentService
  sources: SourceService
  results: ResultService
  planner: DocumentPlanner
  inspector: ImageInspector
  logger: Logger
  workRoot: string
  /** The most a document file may hold, for both the files made and the files taken. */
  maxBundleBytes: number
}

export type ExportedBundle = {
  name: string
  sources: number
  results: number
  bytes: number
}

export type ImportedBundle = {
  document: DocumentView
  summary: {
    sources: number
    results: { imported: number; existing: number; skipped: number }
  }
}
