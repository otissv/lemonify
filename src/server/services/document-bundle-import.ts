import { createReadStream } from 'node:fs'
import path from 'node:path'

import {
  MANIFEST_ENTRY,
  MAX_MANIFEST_BYTES,
  objectEntry,
  parseManifest,
} from '../bundle/manifest.ts'
import type { Manifest } from '../bundle/manifest.ts'
import { fileHash } from '../bundle/file-hash.ts'
import { openZip } from '../bundle/zip.ts'
import type { ZipArchive } from '../bundle/zip.ts'
import { ResultKind } from '../dao/result-dao.ts'
import type { PipelinePlan } from '../render/plan-pipeline.ts'
import type { Actor } from '../domain/actor.ts'
import { LimitError, NotFoundError, ValidationError } from '../errors.ts'
import { withWorkDirectory } from '../tools/work-directory.ts'
import type {
  DocumentBundleServiceDependencies,
  ImportedBundle,
} from './document-bundle-types.ts'
import { UsedItemsImport } from './document-bundle-used.ts'

const NO_FILE = 'The document file was not found.'
const TOO_LARGE = 'The document file is too large.'
const DAMAGED = 'The document file is damaged.'
const FOREIGN_RESULT =
  'The document holds a result that does not belong to any of its steps.'
const WRONG_RESULT_TYPE = 'A result in the document is not the image it says.'

async function open(file: string): Promise<ZipArchive> {
  try {
    return await openZip(file)
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : ''
    if (code === 'ENOENT') throw new NotFoundError(NO_FILE, { cause: error })
    if (code === 'EISDIR') throw new ValidationError(NO_FILE, { cause: error })
    throw error
  }
}

function referencedObjects(manifest: Manifest): string[] {
  const hashes = new Set<string>()
  for (const source of manifest.sources) hashes.add(source.hash)
  for (const result of manifest.results) hashes.add(result.hash)
  return [...hashes]
}

/** Every image the manifest lists is in the file, and together they fit the limit; checked before anything is unpacked. */
function checkObjects(
  archive: ZipArchive,
  manifest: Manifest,
  maxBytes: number,
): void {
  const sizes = new Map(archive.entries.map(({ name, bytes }) => [name, bytes]))
  let total = 0
  for (const hash of referencedObjects(manifest)) {
    const bytes = sizes.get(objectEntry(hash))
    if (bytes === undefined) {
      throw new ValidationError(
        `The document is missing "${objectEntry(hash)}".`,
      )
    }
    total += bytes
  }
  if (total > maxBytes) throw new LimitError(TOO_LARGE)
}

/**
 * Makes a new document for the actor from a document file. The file is not
 * trusted: every image is checked against its hash, every result against the
 * key its step would make and against the image it claims to be. If anything
 * fails, the document and the images this import added are removed again.
 */
export async function importBundle(
  deps: DocumentBundleServiceDependencies,
  actor: Actor,
  file: string,
): Promise<ImportedBundle> {
  const archive = await open(file)
  try {
    const manifest = parseManifest(
      await archive.read(MANIFEST_ENTRY, MAX_MANIFEST_BYTES),
    )
    checkObjects(archive, manifest, deps.maxBundleBytes)
    return await withWorkDirectory(deps.workRoot, (directory) =>
      new BundleImport(deps, actor, archive, manifest, directory).run(),
    )
  } finally {
    await archive.close()
  }
}

class BundleImport {
  readonly #deps: DocumentBundleServiceDependencies
  readonly #actor: Actor
  readonly #archive: ZipArchive
  readonly #manifest: Manifest
  readonly #directory: string
  readonly #addedSourceIds = new Set<string>()
  #documentId: string | undefined
  #used: UsedItemsImport | undefined

  constructor(
    deps: DocumentBundleServiceDependencies,
    actor: Actor,
    archive: ZipArchive,
    manifest: Manifest,
    directory: string,
  ) {
    this.#deps = deps
    this.#actor = actor
    this.#archive = archive
    this.#manifest = manifest
    this.#directory = directory
  }

  async run(): Promise<ImportedBundle> {
    const kept = new Set(
      (await this.#deps.sources.list(this.#actor)).map(
        ({ contentHash }) => contentHash,
      ),
    )
    try {
      return await this.#build(kept)
    } catch (error) {
      await this.#undo()
      throw error
    }
  }

  async #build(kept: Set<string>): Promise<ImportedBundle> {
    const ids = await this.#addSources(kept)
    const used = new UsedItemsImport(
      this.#deps,
      this.#actor,
      this.#manifest,
      ids,
    )
    this.#used = used
    used.requireHeld(this.#manifest.pipeline)
    await used.run()
    const document = await this.#deps.documentService.createFromPipeline(
      this.#actor,
      this.#manifest.name,
      used.remap(this.#manifest.pipeline),
    )
    this.#documentId = document.id
    const results = await this.#addResults(document.id)
    return {
      document,
      summary: { sources: this.#manifest.sources.length, results },
    }
  }

  async #unpack(hash: string): Promise<string> {
    const target = path.join(this.#directory, hash)
    await this.#archive.extract(
      objectEntry(hash),
      target,
      this.#deps.maxBundleBytes,
    )
    if ((await fileHash(target)) !== hash) throw new ValidationError(DAMAGED)
    return target
  }

  async #addSources(kept: Set<string>): Promise<Map<string, string>> {
    const { sources } = this.#deps
    const ids = new Map<string, string>()
    for (const entry of this.#manifest.sources) {
      const target = await this.#unpack(entry.hash)
      const source = await sources.upload(
        this.#actor,
        createReadStream(target),
        entry.fileName,
      )
      if (!kept.has(source.contentHash)) {
        this.#addedSourceIds.add(source.id)
        kept.add(source.contentHash)
      }
      ids.set(entry.id, source.id)
    }
    return ids
  }

  /** Every use of an AI step in the new document's picture: the key its result is stored under, and the used document that owns it when one does. */
  async #expectedPlan(documentId: string): Promise<PipelinePlan> {
    const { documents, planner } = this.#deps
    const record = await documents.findById(documentId)
    if (record === null) throw new Error('The new document is missing.')
    return planner.plan(record)
  }

  async #addResults(
    documentId: string,
  ): Promise<ImportedBundle['summary']['results']> {
    const counts = { imported: 0, existing: 0, skipped: 0 }
    if (this.#manifest.results.length === 0) return counts
    const { aiSteps } = await this.#expectedPlan(documentId)
    const owners = new Map<string, string>()
    for (const entry of this.#manifest.results) {
      const planned = aiSteps.find(
        ({ stepId, key }) => stepId === entry.stepId && key === entry.key,
      )
      if (planned === undefined) throw new ValidationError(FOREIGN_RESULT)
      owners.set(entry.key, planned.documentId ?? documentId)
    }
    for (const entry of this.#manifest.results) {
      if (await this.#deps.results.find(this.#actor.userId, entry.key)) {
        counts.existing += 1
        continue
      }
      const target = await this.#unpack(entry.hash)
      const info = await this.#deps.inspector.inspect(target)
      if (info.mediaType !== entry.mediaType) {
        throw new ValidationError(WRONG_RESULT_TYPE)
      }
      try {
        await this.#deps.results.record(this.#actor, {
          kind: ResultKind.AiStep,
          key: entry.key,
          documentId: owners.get(entry.key) ?? documentId,
          stepId: entry.stepId,
          file: target,
          fileName: entry.fileName,
          mediaType: entry.mediaType,
        })
        counts.imported += 1
      } catch (error) {
        if (!(error instanceof LimitError)) throw error
        counts.skipped += 1
      }
    }
    return counts
  }

  /** Removes what this import added. Images the User already had are kept; a failure here is logged and never hides the error that caused the undo. */
  async #undo(): Promise<void> {
    const { documentService, sources, logger } = this.#deps
    try {
      if (this.#documentId !== undefined) {
        await documentService.delete(this.#actor, this.#documentId)
      }
      await this.#used?.undo()
      for (const id of this.#addedSourceIds) {
        await sources.delete(this.#actor, id)
      }
    } catch (error) {
      logger.error('document import could not be undone', {
        userId: this.#actor.userId,
        reason: error instanceof Error ? error.message : 'unknown',
      })
    }
  }
}
