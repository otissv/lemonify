import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import {
  DOCUMENT_FILE_EXTENSION,
  DOCUMENT_FILE_MEDIA_TYPE,
} from '@/features/documents/document-file'
import { pipelineOperandSourceIds } from '@/features/pipeline/image-operands'

import {
  BUNDLE_FORMAT,
  BUNDLE_VERSION,
  MANIFEST_ENTRY,
  objectEntry,
} from '../bundle/manifest.ts'
import type { Manifest } from '../bundle/manifest.ts'
import { fileHash } from '../bundle/file-hash.ts'
import { ZipWriter } from '../bundle/zip.ts'
import type { DocumentRecord } from '../dao/document-dao.ts'
import type { Actor } from '../domain/actor.ts'
import { requireOwned } from '../domain/ownership.ts'
import { LimitError, ValidationError } from '../errors.ts'
import { isSourceMediaType } from '../tools/image-inspector.ts'
import { withWorkDirectory } from '../tools/work-directory.ts'
import { importBundle } from './document-bundle-import.ts'
import type {
  DocumentBundleServiceDependencies,
  ExportedBundle,
  ImportedBundle,
} from './document-bundle-types.ts'

export type {
  DocumentBundleServiceDependencies,
  ExportedBundle,
  ImportedBundle,
} from './document-bundle-types.ts'

const MISSING_DOCUMENT = 'That image does not exist.'
const TOO_LARGE_TO_EXPORT =
  'This document is too large to save as a file. Remove some images or results first.'
const TOO_LARGE_TO_IMPORT = 'The document file is too large.'
const DAMAGED_IMAGE =
  'An image of this document is damaged, so the document cannot be saved as a file.'
const UNSAFE_FILE_NAME_CHARACTERS = /[\\/:*?"<>|]/g

type StoredObject = { file: string; bytes: number }

/**
 * Document files: a document as one file that another machine can open. Both
 * the website and the CLI call this, so they make and read the same files. A
 * file holds a manifest (name and pipeline) and the images by the hash of their
 * bytes, stored as they are; the images are already compressed, and keeping
 * them untouched keeps their hashes true.
 */
export class DocumentBundleService {
  readonly #deps: DocumentBundleServiceDependencies

  constructor(deps: DocumentBundleServiceDependencies) {
    this.#deps = deps
  }

  async #owned(actor: Actor, documentId: string): Promise<DocumentRecord> {
    return requireOwned(
      actor,
      await this.#deps.documents.findById(documentId),
      MISSING_DOCUMENT,
    )
  }

  /** The file name a document is saved under. */
  async fileNameFor(actor: Actor, documentId: string): Promise<string> {
    const { name } = await this.#owned(actor, documentId)
    const stem = name.replace(UNSAFE_FILE_NAME_CHARACTERS, '_').trim()
    return `${stem === '' ? 'document' : stem}${DOCUMENT_FILE_EXTENSION}`
  }

  /** `destination` as a file path: a folder becomes a file in it named after the document. */
  async resolveDestination(
    actor: Actor,
    documentId: string,
    destination: string,
  ): Promise<string> {
    const info = await stat(destination).catch(() => undefined)
    if (!info?.isDirectory()) return destination
    return path.join(destination, await this.fileNameFor(actor, documentId))
  }

  /**
   * Writes the document, its images and the AI results already made for it to
   * `destination`. The file is built beside it and moved into place when whole,
   * so a failure never leaves half a file, and one that would be too large for
   * the website to take back is refused.
   */
  async exportDocument(
    actor: Actor,
    documentId: string,
    destination: string,
  ): Promise<ExportedBundle> {
    const document = await this.#owned(actor, documentId)
    const target = path.resolve(destination)
    const manifest: Manifest = {
      format: BUNDLE_FORMAT,
      version: BUNDLE_VERSION,
      name: document.name,
      pipeline: document.pipeline,
      sources: [],
      results: [],
      documents: [],
      workflows: [],
    }
    const objects = new Map<string, StoredObject>()
    const imageIds = await this.#collectUsed(actor, document, manifest)
    await this.#collectSources(actor, imageIds, manifest, objects)
    await this.#collectResults(actor, document, manifest, objects)
    this.#checkSize(objects)
    await mkdir(path.dirname(target), { recursive: true })
    const partial = `${target}.${randomUUID()}.partial`
    const writer = await ZipWriter.create(partial)
    try {
      await writer.addBuffer(
        MANIFEST_ENTRY,
        Buffer.from(JSON.stringify(manifest)),
      )
      for (const [hash, { file }] of objects) {
        await writer.addFile(objectEntry(hash), file)
      }
      await writer.close()
      const { size } = await stat(partial)
      if (size > this.#deps.maxBundleBytes) {
        throw new LimitError(TOO_LARGE_TO_EXPORT)
      }
      await rename(partial, target)
      return {
        name: document.name,
        sources: manifest.sources.length,
        results: manifest.results.length,
        bytes: size,
      }
    } catch (error) {
      await writer.abort()
      throw error
    }
  }

  /** Lists every document and workflow the layers use, however deep; the images of all of them and of the document, each once. */
  async #collectUsed(
    actor: Actor,
    document: DocumentRecord,
    manifest: Manifest,
  ): Promise<ReadonlyArray<string>> {
    const images = new Set(pipelineOperandSourceIds(document.pipeline))
    const used = await this.#deps.usedItems.tree(
      actor.userId,
      document.pipeline,
    )
    for (const { id, name, pipeline } of used.documents) {
      manifest.documents.push({ id, name, pipeline })
      for (const image of pipelineOperandSourceIds(pipeline)) images.add(image)
    }
    for (const { id, name, definition } of used.workflows) {
      manifest.workflows.push({ id, name, definition })
      for (const image of pipelineOperandSourceIds(definition.pipeline)) {
        images.add(image)
      }
      for (const image of definition.inputs) images.add(image)
    }
    return [...images]
  }

  async #collectSources(
    actor: Actor,
    imageIds: ReadonlyArray<string>,
    manifest: Manifest,
    objects: Map<string, StoredObject>,
  ): Promise<void> {
    const { sources } = this.#deps
    for (const id of imageIds) {
      const source = await sources.get(actor, id)
      const file = await sources.pathOf(actor, id)
      if ((await fileHash(file)) !== source.contentHash) {
        throw new ValidationError(DAMAGED_IMAGE)
      }
      objects.set(source.contentHash, { file, bytes: source.bytes })
      manifest.sources.push({
        id,
        hash: source.contentHash,
        fileName: source.fileName,
      })
    }
  }

  async #collectResults(
    actor: Actor,
    document: DocumentRecord,
    manifest: Manifest,
    objects: Map<string, StoredObject>,
  ): Promise<void> {
    const { results } = this.#deps
    for (const [stepId, key] of await this.#aiKeys(document)) {
      const record = await results.find(actor.userId, key)
      const file = await results.findPath(actor.userId, key)
      if (record === undefined || file === undefined) continue
      if (!isSourceMediaType(record.mediaType)) continue
      const hash = await fileHash(file)
      objects.set(hash, { file, bytes: record.bytes })
      manifest.results.push({
        key,
        hash,
        stepId,
        fileName: record.fileName,
        mediaType: record.mediaType,
      })
    }
  }

  #checkSize(objects: ReadonlyMap<string, StoredObject>): void {
    let total = 0
    for (const { bytes } of objects.values()) total += bytes
    if (total > this.#deps.maxBundleBytes) {
      throw new LimitError(TOO_LARGE_TO_EXPORT)
    }
  }

  /** The key each AI step's result is stored under. */
  async #aiKeys(
    document: DocumentRecord,
  ): Promise<ReadonlyMap<string, string>> {
    return (await this.#deps.planner.plan(document)).aiKeys
  }

  /** The document as a file to send: a stream that removes its temporary file when it ends, however it ends. */
  async openExport(
    actor: Actor,
    documentId: string,
  ): Promise<{
    stream: Readable
    fileName: string
    bytes: number
    mediaType: string
  }> {
    const fileName = await this.fileNameFor(actor, documentId)
    await mkdir(this.#deps.workRoot, { recursive: true })
    const directory = await mkdtemp(path.join(this.#deps.workRoot, 'export-'))
    try {
      const { bytes } = await this.exportDocument(
        actor,
        documentId,
        path.join(directory, fileName),
      )
      const stream = createReadStream(path.join(directory, fileName))
      stream.once('close', () => {
        void rm(directory, { recursive: true, force: true })
      })
      return { stream, fileName, bytes, mediaType: DOCUMENT_FILE_MEDIA_TYPE }
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      throw error
    }
  }

  /** Makes a new document for the actor from a document file, storing its images and results as the actor's own. */
  importDocument(actor: Actor, file: string): Promise<ImportedBundle> {
    return importBundle(this.#deps, actor, file)
  }

  /** Imports a document file that arrives as a stream, refusing one larger than the limit. */
  importStream(
    actor: Actor,
    body: AsyncIterable<Uint8Array>,
  ): Promise<ImportedBundle> {
    return withWorkDirectory(this.#deps.workRoot, async (directory) => {
      const file = path.join(directory, 'incoming')
      await pipeline(this.#limited(body), createWriteStream(file))
      return this.importDocument(actor, file)
    })
  }

  async *#limited(body: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
    let received = 0
    for await (const chunk of body) {
      received += chunk.length
      if (received > this.#deps.maxBundleBytes) {
        throw new LimitError(TOO_LARGE_TO_IMPORT)
      }
      yield chunk
    }
  }
}
