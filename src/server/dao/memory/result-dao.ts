import type { ResultDao, ResultFilter, ResultRecord } from '../result-dao.ts'

export class MemoryResultDao implements ResultDao {
  readonly #results = new Map<string, ResultRecord>()

  async insert(result: ResultRecord): Promise<void> {
    this.#results.set(result.id, result)
  }

  async findById(id: string): Promise<ResultRecord | null> {
    return this.#results.get(id) ?? null
  }

  async findByKey(ownerId: string, key: string): Promise<ResultRecord | null> {
    const matches = [...this.#results.values()]
      .filter((result) => result.ownerId === ownerId && result.key === key)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return matches[0] ?? null
  }

  async list(ownerId: string, filter: ResultFilter): Promise<ResultRecord[]> {
    return [...this.#results.values()]
      .filter(
        (result) =>
          result.ownerId === ownerId &&
          (filter.documentId === undefined ||
            result.documentId === filter.documentId) &&
          (filter.workflowRunId === undefined ||
            result.workflowRunId === filter.workflowRunId) &&
          (filter.kind === undefined || result.kind === filter.kind),
      )
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
      )
  }

  async delete(id: string): Promise<void> {
    this.#results.delete(id)
  }

  async deleteForDocument(documentId: string): Promise<void> {
    for (const [id, result] of this.#results) {
      if (result.documentId === documentId) this.#results.delete(id)
    }
  }

  async countByKey(key: string): Promise<number> {
    return [...this.#results.values()].filter((result) => result.key === key)
      .length
  }

  async sumBytes(ownerId: string): Promise<number> {
    let total = 0
    for (const result of this.#results.values()) {
      if (result.ownerId === ownerId) total += result.bytes
    }
    return total
  }
}
