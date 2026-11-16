import { ConflictError, NotFoundError } from '../../errors.ts'
import { STALE_DOCUMENT_MESSAGE } from '../document-dao.ts'
import type {
  DocumentDao,
  DocumentRecord,
  HistoryEntryRecord,
  MovedCursor,
  RecordedChange,
} from '../document-dao.ts'
import type { MemoryStore } from './store.ts'

const MISSING = 'That image does not exist.'

export class MemoryDocumentDao implements DocumentDao {
  readonly #store: MemoryStore

  constructor(store: MemoryStore) {
    this.#store = store
  }

  #current(id: string, expectedRevision: number): DocumentRecord {
    const document = this.#store.documents.get(id)
    if (document === undefined) throw new NotFoundError(MISSING)
    if (document.revision !== expectedRevision)
      throw new ConflictError(STALE_DOCUMENT_MESSAGE)
    return document
  }

  #save(document: DocumentRecord, operandSourceIds: string[]): DocumentRecord {
    this.#store.documents.set(document.id, document)
    this.#store.operands.set(document.id, new Set(operandSourceIds))
    return document
  }

  async insert(document: DocumentRecord, sourceIds: string[]): Promise<void> {
    this.#store.documents.set(document.id, document)
    this.#store.entries.set(document.id, [])
    this.#store.operands.set(document.id, new Set(sourceIds))
  }

  async findById(id: string): Promise<DocumentRecord | null> {
    return this.#store.documents.get(id) ?? null
  }

  async listByOwner(ownerId: string): Promise<DocumentRecord[]> {
    return [...this.#store.documents.values()]
      .filter((document) => document.ownerId === ownerId)
      .sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
      )
  }

  async rename(id: string, name: string, now: string): Promise<DocumentRecord> {
    const document = this.#store.documents.get(id)
    if (document === undefined) throw new NotFoundError(MISSING)
    const renamed = { ...document, name, updatedAt: now }
    this.#store.documents.set(id, renamed)
    return renamed
  }

  async delete(id: string): Promise<void> {
    this.#store.documents.delete(id)
    this.#store.entries.delete(id)
    this.#store.operands.delete(id)
  }

  async applyChange(change: RecordedChange): Promise<DocumentRecord> {
    const document = this.#current(change.id, change.expectedRevision)
    const kept = (this.#store.entries.get(change.id) ?? []).filter(
      (entry) => entry.position < document.historyCursor,
    )
    const cursor = document.historyCursor + 1
    kept.push({
      documentId: change.id,
      position: document.historyCursor,
      patch: change.patch,
      createdAt: change.now,
    })
    this.#store.entries.set(
      change.id,
      kept.filter((entry) => entry.position >= cursor - change.maxEntries),
    )
    return this.#save(
      {
        ...document,
        pipeline: change.pipeline,
        revision: document.revision + 1,
        historyCursor: cursor,
        updatedAt: change.now,
      },
      change.operandSourceIds,
    )
  }

  async moveCursor(move: MovedCursor): Promise<DocumentRecord> {
    const document = this.#current(move.id, move.expectedRevision)
    return this.#save(
      {
        ...document,
        pipeline: move.pipeline,
        revision: document.revision + 1,
        historyCursor: move.cursor,
        updatedAt: move.now,
      },
      move.operandSourceIds,
    )
  }

  async findEntry(
    documentId: string,
    position: number,
  ): Promise<HistoryEntryRecord | null> {
    return (
      (this.#store.entries.get(documentId) ?? []).find(
        (entry) => entry.position === position,
      ) ?? null
    )
  }

  async listBySource(sourceId: string): Promise<DocumentRecord[]> {
    return [...this.#store.documents.values()]
      .filter(
        (document) =>
          this.#store.operands.get(document.id)?.has(sourceId) ?? false,
      )
      .sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
      )
  }
}
