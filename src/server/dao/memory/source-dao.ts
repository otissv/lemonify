import type { SourceDao, SourceRecord } from '../source-dao.ts'
import type { MemoryStore } from './store.ts'

export class MemorySourceDao implements SourceDao {
  readonly #store: MemoryStore

  constructor(store: MemoryStore) {
    this.#store = store
  }

  async insert(
    source: SourceRecord,
  ): Promise<{ source: SourceRecord; created: boolean }> {
    for (const existing of this.#store.sources.values()) {
      if (
        existing.ownerId === source.ownerId &&
        existing.contentHash === source.contentHash
      ) {
        return { source: existing, created: false }
      }
    }
    this.#store.sources.set(source.id, source)
    return { source, created: true }
  }

  async findById(id: string): Promise<SourceRecord | null> {
    return this.#store.sources.get(id) ?? null
  }

  async listByOwner(ownerId: string): Promise<SourceRecord[]> {
    return [...this.#store.sources.values()]
      .filter((source) => source.ownerId === ownerId)
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
      )
  }

  async isReferenced(sourceId: string): Promise<boolean> {
    for (const document of this.#store.documents.values()) {
      if (document.sourceId === sourceId) return true
    }
    for (const operands of this.#store.operands.values()) {
      if (operands.has(sourceId)) return true
    }
    return false
  }

  async delete(id: string): Promise<void> {
    if (await this.isReferenced(id)) {
      throw new Error('FOREIGN KEY constraint failed: the Source is in use')
    }
    this.#store.sources.delete(id)
  }

  async countByHash(contentHash: string): Promise<number> {
    let count = 0
    for (const source of this.#store.sources.values()) {
      if (source.contentHash === contentHash) count += 1
    }
    return count
  }
}
