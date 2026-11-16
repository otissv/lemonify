import type { DocumentRecord, HistoryEntryRecord } from '../document-dao.ts'
import type { SourceRecord } from '../source-dao.ts'

/** The data the in-memory DAOs share, so a Source knows which Documents use it. */
export class MemoryStore {
  readonly sources = new Map<string, SourceRecord>()
  readonly documents = new Map<string, DocumentRecord>()
  /** Every Document id, in the order Documents are listed in: newest first unless moved. */
  documentOrder: string[] = []
  readonly entries = new Map<string, HistoryEntryRecord[]>()
  readonly operands = new Map<string, Set<string>>()
}
