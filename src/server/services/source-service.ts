import path from 'node:path'
import type { Readable } from 'node:stream'

import type { SourceDao, SourceRecord } from '../dao/source-dao.ts'
import type { SourceSummary } from '@/features/documents/document'
import type { Actor } from '../domain/actor.ts'
import { isoNow } from '../domain/clock.ts'
import type { Clock, IdGenerator } from '../domain/clock.ts'
import { requireOwned } from '../domain/ownership.ts'
import { ConflictError } from '../errors.ts'
import type { ImageInspector } from '../tools/image-inspector.ts'
import type { SourceStore, StagedUpload } from '../tools/source-store.ts'

const MISSING = 'That image does not exist.'
const MAX_FILE_NAME_LENGTH = 200
const DEFAULT_FILE_NAME = 'image'

export type SourceServiceDependencies = {
  sources: SourceDao
  store: SourceStore
  inspector: ImageInspector
  clock: Clock
  ids: IdGenerator
  maxUploadBytes: number
}

export type OpenedSource = {
  stream: Readable
  mediaType: string
  fileName: string
  bytes: number
}

/** A name safe to show and to send back as a download name: no folders, no control characters. */
/** The part of a Source the browser needs; the bytes are fetched by id. */
export function toSourceSummary(source: SourceRecord): SourceSummary {
  return {
    id: source.id,
    fileName: source.fileName,
    mediaType: source.mediaType,
    bytes: source.bytes,
    width: source.width,
    height: source.height,
  }
}

export function cleanFileName(raw: string): string {
  const base = path.basename(raw.replaceAll('\\', '/'))
  const printable = [...base]
    .filter((char) => char.charCodeAt(0) >= 32 && char !== '\u007f')
    .join('')
  const trimmed = printable.trim().slice(0, MAX_FILE_NAME_LENGTH)
  return trimmed === '' || trimmed === '.' || trimmed === '..'
    ? DEFAULT_FILE_NAME
    : trimmed
}

/**
 * Uploaded images. A Source is kept as a file named by its content hash and
 * is never changed; the same image uploaded again by the same User is the
 * same Source.
 */
export class SourceService {
  readonly #deps: SourceServiceDependencies

  constructor(deps: SourceServiceDependencies) {
    this.#deps = deps
  }

  async upload(
    actor: Actor,
    body: AsyncIterable<Uint8Array>,
    fileName: string,
  ): Promise<SourceRecord> {
    const { store, inspector, sources, ids, clock } = this.#deps
    const staged = await store.stage(body, this.#deps.maxUploadBytes)
    try {
      const info = await inspector.inspect(staged.path)
      const { source, created } = await sources.insert({
        id: ids.next(),
        ownerId: actor.userId,
        contentHash: staged.contentHash,
        fileName: cleanFileName(fileName),
        mediaType: info.mediaType,
        bytes: staged.bytes,
        width: info.width,
        height: info.height,
        createdAt: isoNow(clock),
      })
      await this.#keepFile(staged, source, created)
      return source
    } catch (error) {
      await staged.discard()
      throw error
    }
  }

  /**
   * The row is written before the file is kept, so a sweep never takes a file
   * that is about to get a row; if keeping the file fails, the new row goes.
   */
  async #keepFile(
    staged: StagedUpload,
    source: SourceRecord,
    created: boolean,
  ): Promise<void> {
    try {
      await staged.commit()
    } catch (error) {
      if (created) await this.#deps.sources.delete(source.id)
      throw error
    }
  }

  list(actor: Actor): Promise<SourceRecord[]> {
    return this.#deps.sources.listByOwner(actor.userId)
  }

  async get(actor: Actor, id: string): Promise<SourceRecord> {
    return requireOwned(actor, await this.#deps.sources.findById(id), MISSING)
  }

  async open(actor: Actor, id: string): Promise<OpenedSource> {
    const source = await this.get(actor, id)
    return {
      stream: this.#deps.store.open(source.contentHash),
      mediaType: source.mediaType,
      fileName: source.fileName,
      bytes: source.bytes,
    }
  }

  /** The file for engines that read from disk. The Source must be the actor's. */
  async pathOf(actor: Actor, id: string): Promise<string> {
    const source = await this.get(actor, id)
    return this.#deps.store.pathOf(source.contentHash)
  }

  /** Forgets a Source. Its file goes with the next sweep, so an upload of the same image at the same moment is never left without one. */
  async delete(actor: Actor, id: string): Promise<void> {
    await this.get(actor, id)
    if (await this.#deps.sources.isReferenced(id)) {
      throw new ConflictError(
        'This image is used by a document or one of its steps. Delete those first.',
      )
    }
    await this.#deps.sources.delete(id)
  }

  /**
   * Removes stored files that no Source row points at and that are older than
   * the grace period, and stale unfinished uploads. Run at startup and daily.
   */
  async sweepOrphans(graceMs: number): Promise<number> {
    const { store, sources, clock } = this.#deps
    const nowMs = clock.now().getTime()
    await store.removeStaleUploads(graceMs, nowMs)
    let removed = 0
    for (const { contentHash, modifiedMs } of await store.list()) {
      if (nowMs - modifiedMs <= graceMs) continue
      if ((await sources.countByHash(contentHash)) > 0) continue
      await store.remove(contentHash)
      removed += 1
    }
    return removed
  }
}
