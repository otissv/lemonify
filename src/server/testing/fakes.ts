import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'

import type { AiCatalogue, AiToolId } from '@/features/ai/ai-tools'

import { AiCancelledError, AiEngineError } from '../ai/ai-engine.ts'
import type {
  AiBatch,
  AiEngine,
  AiProgressListener,
  RunningAi,
} from '../ai/ai-engine.ts'
import type { Clock, IdGenerator } from '../domain/clock.ts'
import { ValidationError } from '../errors.ts'
import type {
  EngineOutput,
  EngineRequest,
  ImageEngine,
} from '../tools/image-engine.ts'
import type { ImageInfo, ImageInspector } from '../tools/image-inspector.ts'
import { LimitError } from '../errors.ts'
import type { ResultStore } from '../tools/result-store.ts'
import type { SourceStore, StagedUpload } from '../tools/source-store.ts'

export class FixedClock implements Clock {
  #time: number

  constructor(start = '2026-01-01T00:00:00.000Z') {
    this.#time = new Date(start).getTime()
  }

  now(): Date {
    return new Date(this.#time)
  }

  advance(milliseconds: number): void {
    this.#time += milliseconds
  }
}

export class SequenceIds implements IdGenerator {
  #count = 0
  readonly #prefix: string

  constructor(prefix = 'id') {
    this.#prefix = prefix
  }

  next(): string {
    this.#count += 1
    return `${this.#prefix}-${this.#count}`
  }
}

/** A SourceStore that keeps bytes in memory, for tests of the rules that use it. */
export class MemorySourceStore implements SourceStore {
  readonly files = new Map<string, Buffer>()
  readonly staged = new Set<string>()

  pathOf(contentHash: string): string {
    return `memory://${contentHash}`
  }

  open(contentHash: string): Readable {
    const bytes = this.files.get(contentHash)
    if (bytes === undefined) throw new Error('missing file')
    return Readable.from([bytes])
  }

  async remove(contentHash: string): Promise<void> {
    this.files.delete(contentHash)
  }

  readonly modified = new Map<string, number>()

  async list(): Promise<Array<{ contentHash: string; modifiedMs: number }>> {
    return [...this.files.keys()].map((contentHash) => ({
      contentHash,
      modifiedMs: this.modified.get(contentHash) ?? 0,
    }))
  }

  async removeStaleUploads(): Promise<void> {}

  async stage(
    body: AsyncIterable<Uint8Array>,
    maxBytes: number,
  ): Promise<StagedUpload> {
    const parts: Buffer[] = []
    let bytes = 0
    for await (const chunk of body) {
      bytes += chunk.byteLength
      if (bytes > maxBytes) throw new LimitError('The image is too large.')
      parts.push(Buffer.from(chunk))
    }
    const data = Buffer.concat(parts)
    const contentHash = createHash('sha256').update(data).digest('hex')
    const token = `staged://${contentHash}`
    this.staged.add(token)
    return {
      contentHash,
      bytes,
      path: token,
      commit: async () => {
        this.staged.delete(token)
        if (!this.files.has(contentHash)) this.files.set(contentHash, data)
      },
      discard: async () => {
        this.staged.delete(token)
      },
    }
  }
}

/** Says every upload is an image of a fixed size, except the hashes it is told to refuse. */
export class FakeImageInspector implements ImageInspector {
  readonly refused = new Set<string>()
  info: ImageInfo = { mediaType: 'image/png', width: 10, height: 20 }

  async inspect(file: string): Promise<ImageInfo> {
    const hash = file.replace(/^.*:\/\//, '')
    if (this.refused.has(hash))
      throw new ValidationError('That file is not an image.')
    return this.info
  }
}

export async function* bytesOf(text: string): AsyncGenerator<Uint8Array> {
  yield new TextEncoder().encode(text)
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** A ResultStore that keeps files in memory; `keep` takes the file's content from `contents`. */
export class MemoryResultStore implements ResultStore {
  readonly files = new Map<string, string>()
  readonly modified = new Map<string, number>()
  /** What a temp file path contains, set by the test before `keep`. */
  readonly contents = new Map<string, string>()

  pathOf(key: string): string {
    return `memory-results://${key}`
  }

  async has(key: string): Promise<boolean> {
    return this.files.has(key)
  }

  open(key: string): Readable {
    const content = this.files.get(key)
    if (content === undefined) throw new Error('missing file')
    return Readable.from([Buffer.from(content)])
  }

  async remove(key: string): Promise<void> {
    this.files.delete(key)
  }

  async contentKey(file: string): Promise<string> {
    return createHash('sha256')
      .update(this.contents.get(file) ?? file)
      .digest('hex')
  }

  async keep(file: string, key: string): Promise<void> {
    if (this.files.has(key)) return
    this.files.set(key, this.contents.get(file) ?? file)
  }

  async list(): Promise<Array<{ key: string; modifiedMs: number }>> {
    return [...this.files.keys()].map((key) => ({
      key,
      modifiedMs: this.modified.get(key) ?? 0,
    }))
  }
}

const FAKE_SIZE = 10

/** An ImageEngine that writes a small file naming what it was asked for, and records every request. */
export class FakeImageEngine implements ImageEngine {
  readonly requests: EngineRequest[] = []
  failWith: Error | undefined
  /** When set, `render` waits for it first, so a test can hold work in progress. */
  gate: Promise<void> | undefined

  async render(request: EngineRequest): Promise<EngineOutput> {
    this.requests.push(request)
    if (this.gate) await this.gate
    if (this.failWith) throw this.failWith
    const text = `${request.target.kind}:${request.steps.length}`
    await writeFile(request.output, text)
    return {
      width: FAKE_SIZE,
      height: FAKE_SIZE,
      bytes: text.length,
      format: 'webp',
    }
  }
}

/** An AiEngine that writes a small file per image and records every batch; it can be held, failed or cancelled. */
export class FakeAiEngine implements AiEngine {
  readonly batches: AiBatch[] = []
  failWith: Error | undefined
  gate: Promise<void> | undefined
  catalogueOf: AiCatalogue = { defaultModel: 'fake', models: [] }

  run(batch: AiBatch, onProgress: AiProgressListener): RunningAi {
    this.batches.push(batch)
    let cancelled = false
    let stop: (() => void) | undefined
    const stopped = new Promise<never>((_resolve, reject) => {
      stop = () => reject(new AiCancelledError())
    })
    const work = async () => {
      if (this.gate) await this.gate
      if (cancelled) throw new AiCancelledError()
      if (this.failWith) throw new AiEngineError(this.failWith.message)
      const done: Array<{ id: string; width: number; height: number }> = []
      for (const request of batch.requests) {
        await writeFile(request.output, `ai:${request.id}`)
        done.push({
          id: request.id,
          width: FAKE_SIZE * 4,
          height: FAKE_SIZE * 4,
        })
        onProgress(done.length / batch.requests.length)
      }
      return done
    }
    return {
      result: Promise.race([work(), stopped]),
      cancel: () => {
        cancelled = true
        stop?.()
      },
    }
  }

  async catalogue(_tool: AiToolId): Promise<AiCatalogue> {
    return this.catalogueOf
  }
}
