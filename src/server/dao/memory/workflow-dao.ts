import { ConflictError, NotFoundError } from '../../errors.ts'
import { STALE_WORKFLOW_MESSAGE } from '../workflow-dao.ts'
import type {
  MovedWorkflowCursor,
  RecordedWorkflowChange,
  RunState,
  WorkflowDao,
  WorkflowHistoryEntryRecord,
  WorkflowRecord,
  WorkflowRunRecord,
} from '../workflow-dao.ts'

const MISSING = 'That workflow does not exist.'

export class MemoryWorkflowDao implements WorkflowDao {
  readonly #workflows = new Map<string, WorkflowRecord>()
  readonly #entries = new Map<string, WorkflowHistoryEntryRecord[]>()
  readonly #runs = new Map<string, WorkflowRunRecord>()

  async insert(workflow: WorkflowRecord): Promise<void> {
    this.#workflows.set(workflow.id, structuredClone(workflow))
  }

  async findById(id: string): Promise<WorkflowRecord | null> {
    const found = this.#workflows.get(id)
    return found === undefined ? null : structuredClone(found)
  }

  async listByOwner(ownerId: string): Promise<WorkflowRecord[]> {
    return [...this.#workflows.values()]
      .filter((workflow) => workflow.ownerId === ownerId)
      .sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
      )
      .map((workflow) => structuredClone(workflow))
  }

  async rename(id: string, name: string, now: string): Promise<WorkflowRecord> {
    const found = this.#workflows.get(id)
    if (found === undefined) throw new NotFoundError(MISSING)
    const next: WorkflowRecord = { ...found, name, updatedAt: now }
    this.#workflows.set(id, next)
    return structuredClone(next)
  }

  #locked(id: string, expectedRevision: number): WorkflowRecord {
    const found = this.#workflows.get(id)
    if (found === undefined) throw new NotFoundError(MISSING)
    if (found.revision !== expectedRevision) {
      throw new ConflictError(STALE_WORKFLOW_MESSAGE)
    }
    return found
  }

  async applyChange(change: RecordedWorkflowChange): Promise<WorkflowRecord> {
    const found = this.#locked(change.id, change.expectedRevision)
    const cursor = found.historyCursor + 1
    const kept = (this.#entries.get(change.id) ?? []).filter(
      ({ position }) =>
        position < found.historyCursor &&
        position >= cursor - change.maxEntries,
    )
    kept.push({
      workflowId: change.id,
      position: found.historyCursor,
      patch: structuredClone(change.patch),
      createdAt: change.now,
    })
    this.#entries.set(change.id, kept)
    const next: WorkflowRecord = {
      ...found,
      definition: structuredClone(change.definition),
      revision: found.revision + 1,
      historyCursor: cursor,
      updatedAt: change.now,
    }
    this.#workflows.set(change.id, next)
    return structuredClone(next)
  }

  async moveCursor(move: MovedWorkflowCursor): Promise<WorkflowRecord> {
    const found = this.#locked(move.id, move.expectedRevision)
    const next: WorkflowRecord = {
      ...found,
      definition: structuredClone(move.definition),
      revision: found.revision + 1,
      historyCursor: move.cursor,
      updatedAt: move.now,
    }
    this.#workflows.set(move.id, next)
    return structuredClone(next)
  }

  async findEntry(
    workflowId: string,
    position: number,
  ): Promise<WorkflowHistoryEntryRecord | null> {
    const found = (this.#entries.get(workflowId) ?? []).find(
      (entry) => entry.position === position,
    )
    return found === undefined ? null : structuredClone(found)
  }

  async delete(id: string): Promise<void> {
    this.#workflows.delete(id)
    this.#entries.delete(id)
    for (const run of this.#runs.values()) {
      if (run.workflowId === id) run.workflowId = null
    }
  }

  async insertRun(run: WorkflowRunRecord): Promise<void> {
    this.#runs.set(run.id, structuredClone(run))
  }

  async deleteRun(id: string): Promise<void> {
    this.#runs.delete(id)
  }

  async findRun(id: string): Promise<WorkflowRunRecord | null> {
    const found = this.#runs.get(id)
    return found === undefined ? null : structuredClone(found)
  }

  async listRuns(
    ownerId: string,
    workflowId?: string,
  ): Promise<WorkflowRunRecord[]> {
    return [...this.#runs.values()]
      .filter(
        (run) =>
          run.ownerId === ownerId &&
          (workflowId === undefined || run.workflowId === workflowId),
      )
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
      )
      .map((run) => structuredClone(run))
  }

  async updateRunState(
    id: string,
    state: RunState,
    finishedAt: string | null,
  ): Promise<void> {
    const found = this.#runs.get(id)
    if (found === undefined) return
    found.state = state
    found.finishedAt = finishedAt
  }
}
