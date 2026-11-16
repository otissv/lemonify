// @vitest-environment node
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'

import sharp from 'sharp'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AiToolId } from '@/features/ai/ai-tools'
import { ExportFormat } from '@/features/export/export-settings'
import {
  createAiStep,
  createLayerStep,
  createSharpStep,
} from '@/features/pipeline/pipeline'
import type { Pipeline } from '@/features/pipeline/pipeline'

import { LimitError, NotFoundError, ValidationError } from '../errors.ts'
import { ZipWriter, openZip } from '../bundle/zip.ts'
import { workDir } from '../config/config.ts'
import { isTerminal } from '../jobs/job-types.ts'
import { createTestApp } from '../testing/test-app.ts'
import type { TestApp } from '../testing/test-app.ts'

const SETTINGS = { model: 'm', scale: 4, iterations: 1, tta: false } as const
const sha256 = (bytes: Buffer): string =>
  createHash('sha256').update(bytes).digest('hex')

let t: TestApp

const OBJECT_LIMIT = 1024 * 1024

beforeEach(async () => {
  t = await createTestApp()
  t.aiEngine.output = await sharp({
    create: { width: 32, height: 24, channels: 3, background: '#0a0' },
  })
    .png()
    .toBuffer()
})

afterEach(async () => {
  await t.close()
})

function file(name: string): string {
  return path.join(t.directory, name)
}

async function change(documentId: string, pipeline: Pipeline) {
  const view = await t.app.documents.get(t.ann, documentId)
  let revision = view.revision
  for (const [index, step] of pipeline.steps.entries()) {
    const next = await t.app.documents.change(t.ann, documentId, revision, {
      type: 'add-step',
      step,
      index: view.pipeline.steps.length + index,
    })
    revision = next.revision
  }
}

async function runAiStep(documentId: string, stepId: string): Promise<void> {
  await t.app.scheduler.start()
  const queued = await t.app.renders.requestAiStep(t.ann, documentId, stepId)
  const limit = Date.now() + 3000
  while (Date.now() < limit) {
    const job = await t.app.jobs.get(t.ann, queued.id)
    if (isTerminal(job.state)) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('The AI step did not finish in time.')
}

/** A document with a mask as a layer, a boolean step using it as a second image, and an upscale that has run. */
async function makeDocument() {
  const base = await t.uploadImage(t.ann, '#336699', 'base.png')
  const mask = await t.uploadImage(t.ann, '#cc0000', 'mask.png')
  const created = await t.app.documents.create(t.ann, base.id, 'Collage')
  const layer = createLayerStep(mask.id)
  const boolean = createSharpStep('boolean', {
    operand: mask.id,
    operator: 'and',
  })
  const upscale = createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS })
  await change(created.id, { steps: [layer, boolean, upscale] })
  await runAiStep(created.id, upscale.id)
  return { base, mask, created, layer, boolean, upscale }
}

describe('DocumentBundleService', () => {
  it('exports a document as one file and imports it for another User', async () => {
    const { base, mask, created, layer, boolean, upscale } =
      await makeDocument()
    const bundle = file('collage.lemon')

    const exported = await t.app.bundles.exportDocument(
      t.ann,
      created.id,
      bundle,
    )
    const imported = await t.app.bundles.importDocument(t.bob, bundle)

    expect(exported).toMatchObject({ name: 'Collage', sources: 2, results: 1 })
    expect(imported.summary).toMatchObject({
      sources: 2,
      results: { imported: 1, existing: 0, skipped: 0 },
    })
    const view = imported.document
    expect(view.name).toBe('Collage')
    expect(view.pipeline.steps.map(({ id }) => id)).toEqual([
      expect.any(String),
      layer.id,
      boolean.id,
      upscale.id,
    ])
    const theirMask = view.sources.find(
      ({ fileName }) => fileName === 'mask.png',
    )
    expect(theirMask?.id).not.toBe(mask.id)
    expect(view.pipeline.steps[1]).toMatchObject({ sourceId: theirMask?.id })
    expect(view.pipeline.steps[2]).toMatchObject({
      options: { operand: theirMask?.id },
    })
    expect(view.sources.map(({ fileName }) => fileName)).toEqual([
      'base.png',
      'mask.png',
    ])
    const theirBase = view.source
    expect(
      sha256(
        await readFile(await t.app.sources.pathOf(t.bob, theirBase?.id ?? '')),
      ),
    ).toBe(sha256(await readFile(await t.app.sources.pathOf(t.ann, base.id))))
  })

  it('brings the AI results along, so nothing has to run again', async () => {
    const { created } = await makeDocument()
    const bundle = file('collage.lemon')
    await t.app.bundles.exportDocument(t.ann, created.id, bundle)

    const imported = await t.app.bundles.importDocument(t.bob, bundle)

    await expect(
      t.app.renders.requestExport(t.bob, imported.document.id, {
        format: ExportFormat.Png,
        options: {},
        keepMetadata: false,
      }),
    ).resolves.toBeDefined()
  })

  it('leaves out results that were never made', async () => {
    const base = await t.uploadImage(t.ann)
    const created = await t.app.documents.create(t.ann, base.id)
    await change(created.id, {
      steps: [createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS })],
    })

    const exported = await t.app.bundles.exportDocument(
      t.ann,
      created.id,
      file('plain.lemon'),
    )

    expect(exported.results).toBe(0)
  })

  it('imports the same file twice without storing anything twice', async () => {
    const { created } = await makeDocument()
    const bundle = file('collage.lemon')
    await t.app.bundles.exportDocument(t.ann, created.id, bundle)

    const first = await t.app.bundles.importDocument(t.bob, bundle)
    const second = await t.app.bundles.importDocument(t.bob, bundle)

    expect(second.document.id).not.toBe(first.document.id)
    expect(second.summary.results).toMatchObject({ imported: 0, existing: 1 })
    expect(await t.app.sources.list(t.bob)).toHaveLength(2)
  })

  it('refuses to export a document that is not the User’s', async () => {
    const { created } = await makeDocument()

    await expect(
      t.app.bundles.exportDocument(t.bob, created.id, file('x.lemon')),
    ).rejects.toThrow(NotFoundError)
  })

  it('refuses a file that is not a document', async () => {
    await writeFile(file('plain.txt'), 'hello')

    await expect(
      t.app.bundles.importDocument(t.ann, file('plain.txt')),
    ).rejects.toThrow(/not a Lemonify document/)
  })

  it('refuses an image that does not match the hash the document lists', async () => {
    const bytes = Buffer.from('not the image it says')
    const writer = await ZipWriter.create(file('lying.lemon'))
    const hash = 'a'.repeat(64)
    await writer.addBuffer(
      'manifest.json',
      Buffer.from(
        JSON.stringify({
          format: 'lemonify-document',
          version: 2,
          name: 'Lying',
          pipeline: {
            steps: [
              {
                id: '00000000-0000-4000-8000-000000000001',
                kind: 'layer',
                sourceId: 's1',
                enabled: true,
              },
            ],
          },
          sources: [
            {
              id: 's1',
              hash,
              fileName: 'a.png',
            },
          ],
          results: [],
        }),
      ),
    )
    await writeFile(file('object'), bytes)
    await writer.addFile(`objects/${hash}`, file('object'))
    await writer.close()

    await expect(
      t.app.bundles.importDocument(t.ann, file('lying.lemon')),
    ).rejects.toThrow(/damaged/)
  })

  it('refuses a pipeline that uses an image the document does not hold', async () => {
    const writer = await ZipWriter.create(file('short.lemon'))
    await writer.addBuffer(
      'manifest.json',
      Buffer.from(
        JSON.stringify({
          format: 'lemonify-document',
          version: 2,
          name: 'Short',
          pipeline: {
            steps: [
              {
                id: '00000000-0000-4000-8000-000000000001',
                kind: 'layer',
                sourceId: 'missing',
                enabled: true,
              },
            ],
          },
          sources: [],
          results: [],
        }),
      ),
    )
    await writer.close()

    await expect(
      t.app.bundles.importDocument(t.ann, file('short.lemon')),
    ).rejects.toThrow(ValidationError)
  })

  it('refuses a document made by an older version, before images were layers', async () => {
    const writer = await ZipWriter.create(file('older.lemon'))
    await writer.addBuffer(
      'manifest.json',
      Buffer.from(JSON.stringify({ format: 'lemonify-document', version: 1 })),
    )
    await writer.close()

    await expect(
      t.app.bundles.importDocument(t.ann, file('older.lemon')),
    ).rejects.toThrow(/older version/)
  })

  it('refuses a document made by a newer version', async () => {
    const writer = await ZipWriter.create(file('newer.lemon'))
    await writer.addBuffer(
      'manifest.json',
      Buffer.from(JSON.stringify({ format: 'lemonify-document', version: 99 })),
    )
    await writer.close()

    await expect(
      t.app.bundles.importDocument(t.ann, file('newer.lemon')),
    ).rejects.toThrow(/newer version/)
  })

  it('streams an export and imports a document that arrives as a stream', async () => {
    const { created } = await makeDocument()

    const opened = await t.app.bundles.openExport(t.ann, created.id)
    const chunks: Buffer[] = []
    for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk))
    const bytes = Buffer.concat(chunks)
    const imported = await t.app.bundles.importStream(
      t.bob,
      Readable.from([bytes]),
    )

    expect(opened.fileName).toBe('Collage.lemon')
    expect(bytes.length).toBe(opened.bytes)
    expect(imported.document.name).toBe('Collage')
    expect(imported.summary.results.imported).toBe(1)
  })

  it('refuses a document file larger than the limit', async () => {
    await t.close()
    t = await createTestApp({ LEMONIFY_MAX_BUNDLE_BYTES: '10' })

    await expect(
      t.app.bundles.importStream(t.ann, Readable.from([Buffer.alloc(11)])),
    ).rejects.toThrow(LimitError)
  })

  describe('export', () => {
    it('makes the same file every time for the same document', async () => {
      const { created } = await makeDocument()

      await t.app.bundles.exportDocument(t.ann, created.id, file('a.lemon'))
      await t.app.bundles.exportDocument(t.ann, created.id, file('b.lemon'))

      expect(await readFile(file('a.lemon'))).toEqual(
        await readFile(file('b.lemon')),
      )
    })

    it('creates the folder it writes into', async () => {
      const { created } = await makeDocument()
      const target = file('deep/er/collage.lemon')

      await t.app.bundles.exportDocument(t.ann, created.id, target)

      const archive = await openZip(target)
      expect(archive.entries.length).toBeGreaterThan(1)
      await archive.close()
    })

    it('leaves nothing behind when it fails', async () => {
      const { created, base } = await makeDocument()
      await writeFile(await t.app.sources.pathOf(t.ann, base.id), 'damaged')
      const target = file('failed.lemon')

      await expect(
        t.app.bundles.exportDocument(t.ann, created.id, target),
      ).rejects.toThrow(ValidationError)

      expect(await readdir(t.directory)).not.toContain('failed.lemon')
      expect(
        (await readdir(t.directory)).filter((name) => name.includes('failed')),
      ).toEqual([])
    })

    it('refuses a document whose images would not fit in a file the website accepts', async () => {
      await t.close()
      t = await createTestApp({ LEMONIFY_MAX_BUNDLE_BYTES: '50' })
      const base = await t.uploadImage(t.ann)
      const created = await t.app.documents.create(t.ann, base.id)

      await expect(
        t.app.bundles.exportDocument(t.ann, created.id, file('big.lemon')),
      ).rejects.toThrow(LimitError)
      expect(await readdir(t.directory)).not.toContain('big.lemon')
    })

    it('names the file after the document, without characters a file name cannot hold', async () => {
      const base = await t.uploadImage(t.ann)
      const created = await t.app.documents.create(
        t.ann,
        base.id,
        'a/b:c*d?"e<f>g|h\\i',
      )

      expect(await t.app.bundles.fileNameFor(t.ann, created.id)).toBe(
        'a_b_c_d__e_f_g_h_i.lemon',
      )
    })

    it('removes the temporary file when the download stops early', async () => {
      const { created } = await makeDocument()

      const opened = await t.app.bundles.openExport(t.ann, created.id)
      opened.stream.destroy()
      await new Promise((resolve) => opened.stream.once('close', resolve))

      await vi.waitFor(async () => {
        expect(await readdir(workDir(t.app.config))).toEqual([])
      })
    })

    it('removes the temporary file when the export fails', async () => {
      await expect(t.app.bundles.openExport(t.bob, 'missing')).rejects.toThrow(
        NotFoundError,
      )

      expect(await readdir(workDir(t.app.config))).toEqual([])
    })
  })

  describe('import', () => {
    async function exported(): Promise<string> {
      const { created } = await makeDocument()
      const bundle = file('collage.lemon')
      await t.app.bundles.exportDocument(t.ann, created.id, bundle)
      return bundle
    }

    /** Writes a copy of a document file with its manifest changed and the images replaced or added. */
    async function tampered(
      from: string,
      change: (manifest: Record<string, unknown>) => Record<string, unknown>,
      images: Record<string, Buffer> = {},
    ): Promise<string> {
      const archive = await openZip(from)
      const manifest: Record<string, unknown> = JSON.parse(
        (await archive.read('manifest.json', OBJECT_LIMIT)).toString(),
      )
      const to = file('tampered.lemon')
      const writer = await ZipWriter.create(to)
      await writer.addBuffer(
        'manifest.json',
        Buffer.from(JSON.stringify(change(manifest))),
      )
      for (const { name } of archive.entries) {
        if (name === 'manifest.json' || name in images) continue
        const bytes = await archive.read(name, OBJECT_LIMIT)
        await writer.addBuffer(name, bytes)
      }
      for (const [name, bytes] of Object.entries(images)) {
        await writer.addBuffer(name, bytes)
      }
      await writer.close()
      await archive.close()
      return to
    }

    async function nothingKept(): Promise<void> {
      expect(await t.app.documents.list(t.bob)).toEqual([])
      expect(await t.app.sources.list(t.bob)).toEqual([])
      expect(await t.app.results.list(t.bob)).toEqual([])
    }

    type Entries = Array<Record<string, unknown>>

    it('refuses a result that does not belong to any step of the document', async () => {
      const bundle = await tampered(await exported(), (manifest) => ({
        ...manifest,
        results: (manifest.results as Entries).map((result) => ({
          ...result,
          key: 'b'.repeat(64),
        })),
      }))

      await expect(t.app.bundles.importDocument(t.bob, bundle)).rejects.toThrow(
        ValidationError,
      )
      await nothingKept()
    })

    it('refuses a result for a step the document does not have', async () => {
      const bundle = await tampered(await exported(), (manifest) => ({
        ...manifest,
        results: (manifest.results as Entries).map((result) => ({
          ...result,
          stepId: '00000000-0000-4000-8000-000000000000',
        })),
      }))

      await expect(t.app.bundles.importDocument(t.bob, bundle)).rejects.toThrow(
        ValidationError,
      )
      await nothingKept()
    })

    it('refuses a result that is not an image, whatever type it claims', async () => {
      const html = Buffer.from('<script>alert(1)</script>')
      const hash = sha256(html)
      const bundle = await tampered(
        await exported(),
        (manifest) => ({
          ...manifest,
          results: (manifest.results as Entries).map((result) => ({
            ...result,
            hash,
            mediaType: 'image/png',
          })),
        }),
        { [`objects/${hash}`]: html },
      )

      await expect(t.app.bundles.importDocument(t.bob, bundle)).rejects.toThrow(
        ValidationError,
      )
      await nothingKept()
    })

    it('refuses a result that claims a type other than an image', async () => {
      const bundle = await tampered(await exported(), (manifest) => ({
        ...manifest,
        results: (manifest.results as Entries).map((result) => ({
          ...result,
          mediaType: 'text/html',
        })),
      }))

      await expect(t.app.bundles.importDocument(t.bob, bundle)).rejects.toThrow(
        ValidationError,
      )
      await nothingKept()
    })

    it('refuses a result that claims a different image type than it is', async () => {
      const bundle = await tampered(await exported(), (manifest) => ({
        ...manifest,
        results: (manifest.results as Entries).map((result) => ({
          ...result,
          mediaType: 'image/jpeg',
        })),
      }))

      await expect(t.app.bundles.importDocument(t.bob, bundle)).rejects.toThrow(
        ValidationError,
      )
      await nothingKept()
    })

    it('keeps nothing when an image inside the file is damaged', async () => {
      const original = await exported()
      const archive = await openZip(original)
      const manifest = JSON.parse(
        (await archive.read('manifest.json', OBJECT_LIMIT)).toString(),
      )
      await archive.close()
      const [result] = manifest.results as Entries
      const bundle = await tampered(original, (value) => value, {
        [`objects/${String(result?.hash)}`]: Buffer.from('replaced'),
      })

      await expect(t.app.bundles.importDocument(t.bob, bundle)).rejects.toThrow(
        ValidationError,
      )
      await nothingKept()
    })

    it('keeps images Bob already had when an import fails', async () => {
      const own = await t.uploadImage(t.bob, '#336699', 'mine.png')
      const bundle = await tampered(await exported(), (manifest) => ({
        ...manifest,
        results: (manifest.results as Entries).map((result) => ({
          ...result,
          key: 'b'.repeat(64),
        })),
      }))

      await expect(t.app.bundles.importDocument(t.bob, bundle)).rejects.toThrow(
        ValidationError,
      )

      expect((await t.app.sources.list(t.bob)).map(({ id }) => id)).toEqual([
        own.id,
      ])
    })

    it('refuses a file whose images add up to more than a document file may hold', async () => {
      await t.close()
      t = await createTestApp({ LEMONIFY_MAX_BUNDLE_BYTES: '1000' })
      const bytes = Buffer.alloc(2000, 1)
      const hash = sha256(bytes)
      const writer = await ZipWriter.create(file('heavy.lemon'))
      await writer.addBuffer(
        'manifest.json',
        Buffer.from(
          JSON.stringify({
            format: 'lemonify-document',
            version: 2,
            name: 'Heavy',
            pipeline: { steps: [createLayerStep('s1')] },
            sources: [{ id: 's1', hash, fileName: 'a.png' }],
            results: [],
          }),
        ),
      )
      await writer.addBuffer(`objects/${hash}`, bytes)
      await writer.close()

      await expect(
        t.app.bundles.importDocument(t.bob, file('heavy.lemon')),
      ).rejects.toThrow(LimitError)
      await nothingKept()
    })

    it('says so when the file is not there', async () => {
      await expect(
        t.app.bundles.importDocument(t.ann, file('nowhere.lemon')),
      ).rejects.toThrow(NotFoundError)
    })

    it('refuses a folder in place of a file', async () => {
      await expect(
        t.app.bundles.importDocument(t.ann, t.directory),
      ).rejects.toThrow(ValidationError)
    })

    it('refuses a file that lists the same result twice', async () => {
      const bundle = await tampered(await exported(), (manifest) => ({
        ...manifest,
        results: [
          ...(manifest.results as Entries),
          ...(manifest.results as Entries),
        ],
      }))

      await expect(t.app.bundles.importDocument(t.bob, bundle)).rejects.toThrow(
        ValidationError,
      )
      await nothingKept()
    })

    it('cleans up its work folder when the file cannot be read from the stream', async () => {
      async function* broken(): AsyncGenerator<Uint8Array> {
        yield new Uint8Array(4)
        throw new Error('connection lost')
      }

      await expect(t.app.bundles.importStream(t.ann, broken())).rejects.toThrow(
        'connection lost',
      )

      expect(await readdir(workDir(t.app.config))).toEqual([])
    })

    it('cleans up its work folder after a refused file', async () => {
      await expect(
        t.app.bundles.importStream(t.ann, Readable.from([Buffer.alloc(40)])),
      ).rejects.toThrow(ValidationError)

      expect(await readdir(workDir(t.app.config))).toEqual([])
    })
  })
})
