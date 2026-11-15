import { stat } from 'node:fs/promises'
import type { Readable } from 'node:stream'

import type {
  ResultDao,
  ResultFilter,
  ResultKind,
  ResultRecord,
} from '../dao/result-dao.ts'
import type { Actor } from '../domain/actor.ts'
import { isoNow } from '../domain/clock.ts'
import type { Clock, IdGenerator } from '../domain/clock.ts'
import { requireOwned } from '../domain/ownership.ts'
import { LimitError } from '../errors.ts'
import type { ResultStore } from '../tools/result-store.ts'
import type { DocumentCleanup } from './document-service.ts'

const MISSING = 'That result does not exist.'
const QUOTA_MESSAGE =
  'You have reached your storage limit for results. Delete results you no longer need and try again.'

export type ResultServiceDependencies = {
  results: ResultDao
  store: ResultStore
  clock: Clock
  ids: IdGenerator
  maxBytesPerUser: number
}

export type NewResult = {
  kind: ResultKind
  /** Names the stored file; omitted, it is the hash of the file's content. */
  key?: string
  documentId?: string
  stepId?: string
  workflowRunId?: string
  /** The finished file; it is moved into the store. */
  file: string
  fileName: string
  mediaType: string
}

export type OpenedResult = {
  stream: Readable
  mediaType: string
  fileName: string
  bytes: number
}

/**
 * Images that cost real work or that the User asked for. Unlike Renders they
 * are never evicted: they go only when the User deletes them or their
 * Document, and a quota limits what a User keeps.
 */
export class ResultService implements DocumentCleanup {
  readonly #deps: ResultServiceDependencies

  constructor(deps: ResultServiceDependencies) {
    this.#deps = deps
  }

  /** Refuses early, before a Job that would make a Result is queued. */
  async assertWithinQuota(actor: Actor): Promise<void> {
    const used = await this.#deps.results.sumBytes(actor.userId)
    if (used >= this.#deps.maxBytesPerUser) throw new LimitError(QUOTA_MESSAGE)
  }

  async record(actor: Actor, input: NewResult): Promise<ResultRecord> {
    const { results, store, clock, ids } = this.#deps
    const { size } = await stat(input.file)
    const used = await results.sumBytes(actor.userId)
    if (used + size > this.#deps.maxBytesPerUser)
      throw new LimitError(QUOTA_MESSAGE)
    const key = input.key ?? (await store.contentKey(input.file))
    const record: ResultRecord = {
      id: ids.next(),
      ownerId: actor.userId,
      kind: input.kind,
      key,
      documentId: input.documentId ?? null,
      stepId: input.stepId ?? null,
      workflowRunId: input.workflowRunId ?? null,
      fileName: input.fileName,
      mediaType: input.mediaType,
      bytes: size,
      createdAt: isoNow(clock),
    }
    await results.insert(record)
    await store.keep(input.file, key)
    return record
  }

  /** The User's Result under a key, if there is one and its file is stored. */
  async find(ownerId: string, key: string): Promise<ResultRecord | undefined> {
    const record = await this.#deps.results.findByKey(ownerId, key)
    if (record === null) return undefined
    return (await this.#deps.store.has(key)) ? record : undefined
  }

  /** The stored file of the User's Result under a key, or undefined when there is none. */
  async findPath(ownerId: string, key: string): Promise<string | undefined> {
    const record = await this.#deps.results.findByKey(ownerId, key)
    if (record === null) return undefined
    return (await this.#deps.store.has(key))
      ? this.#deps.store.pathOf(key)
      : undefined
  }

  list(actor: Actor, filter: ResultFilter = {}): Promise<ResultRecord[]> {
    return this.#deps.results.list(actor.userId, filter)
  }

  async get(actor: Actor, id: string): Promise<ResultRecord> {
    return requireOwned(actor, await this.#deps.results.findById(id), MISSING)
  }

  async open(actor: Actor, id: string): Promise<OpenedResult> {
    const record = await this.get(actor, id)
    return {
      stream: this.#deps.store.open(record.key),
      mediaType: record.mediaType,
      fileName: record.fileName,
      bytes: record.bytes,
    }
  }

  async usedBytes(actor: Actor): Promise<number> {
    return this.#deps.results.sumBytes(actor.userId)
  }

  /** Forgets a Result. Its file goes with the next sweep. */
  async delete(actor: Actor, id: string): Promise<void> {
    await this.get(actor, id)
    await this.#deps.results.delete(id)
  }

  /** Part of deleting a Document: its Results go too. */
  async onDocumentDeleted(_actor: Actor, documentId: string): Promise<void> {
    await this.#deps.results.deleteForDocument(documentId)
  }

  /** Removes stored files that no Result points at and that are older than the grace period. */
  async sweepOrphans(graceMs: number): Promise<number> {
    const { store, results, clock } = this.#deps
    const nowMs = clock.now().getTime()
    let removed = 0
    for (const { key, modifiedMs } of await store.list()) {
      if (nowMs - modifiedMs <= graceMs) continue
      if ((await results.countByKey(key)) > 0) continue
      await store.remove(key)
      removed += 1
    }
    return removed
  }
}
