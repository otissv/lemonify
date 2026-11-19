// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AiToolId } from '../../src/features/ai/ai-tools.ts'
import {
  createAiStep,
  createSharpStep,
} from '../../src/features/pipeline/pipeline.ts'
import type { PipelineStep } from '../../src/features/pipeline/pipeline.ts'
import { NotFoundError, ValidationError } from '../../src/server/errors.ts'
import { createTestApp } from '../../src/server/testing/test-app.ts'
import type { TestApp } from '../../src/server/testing/test-app.ts'
import { writePreview } from './preview-document.ts'

const SETTINGS = { model: 'm', scale: 4, iterations: 1, tta: false } as const

let t: TestApp
let out = ''

beforeEach(async () => {
  t = await createTestApp()
  await t.app.scheduler.start()
  out = mkdtempSync(path.join(os.tmpdir(), 'lemonify-preview-'))
})

afterEach(async () => {
  await t.close()
  rmSync(out, { recursive: true, force: true })
})

async function newDocument() {
  const source = await t.uploadImage(t.ann, '#336699', 'cat.png')
  return t.app.documents.create(t.ann, source.id)
}

async function addStep(documentId: string, step: PipelineStep) {
  const view = await t.app.documents.get(t.ann, documentId)
  await t.app.documents.change(t.ann, documentId, view.revision, {
    type: 'add-step',
    step,
    index: view.pipeline.steps.length,
  })
}

describe('writePreview', () => {
  it('writes the picture the canvas would show', async () => {
    const document = await newDocument()
    await addStep(document.id, createSharpStep('flop'))
    const file = path.join(out, 'look.webp')

    const written = await writePreview(t.app, t.ann, document.id, file)

    expect(written).toMatchObject({
      path: file,
      format: 'webp',
      original: false,
      pending: [],
      problems: [],
    })
    expect(readFileSync(file).length).toBe(written.bytes)
    expect(readFileSync(file, 'utf8')).toMatch(/^.+:\d+$/)
  })

  it('says how big the picture is in its own pixels', async () => {
    const document = await newDocument()

    const written = await writePreview(
      t.app,
      t.ann,
      document.id,
      path.join(out, 'size.webp'),
    )

    expect(written.size).toEqual({ width: 40, height: 30 })
  })

  it('has no size for the image as opened', async () => {
    const document = await newDocument()

    const written = await writePreview(
      t.app,
      t.ann,
      document.id,
      path.join(out, 'original.png'),
      { original: true },
    )

    expect(written.size).toBeNull()
  })

  it('shows the picture a step acts on when asked, and says which step', async () => {
    const document = await newDocument()
    const blur = createSharpStep('blur', { sigma: 2 })
    const extract = createSharpStep('extract', {
      left: 0,
      top: 0,
      width: 2,
      height: 2,
    })
    await addStep(document.id, blur)
    await addStep(document.id, extract)

    const written = await writePreview(
      t.app,
      t.ann,
      document.id,
      path.join(out, 'before.webp'),
      { beforeStepId: extract.id },
    )

    expect(written.beforeStepId).toBe(extract.id)
    expect(readFileSync(path.join(out, 'before.webp'), 'utf8')).toBe(
      'preview:2',
    )
  })

  it('has no step in the picture of the whole document', async () => {
    const document = await newDocument()

    const written = await writePreview(
      t.app,
      t.ann,
      document.id,
      path.join(out, 'whole.webp'),
    )

    expect(written.beforeStepId).toBeNull()
  })

  it('refuses a step the document does not have, and the original together with a step', async () => {
    const document = await newDocument()
    const file = path.join(out, 'x.webp')

    await expect(
      writePreview(t.app, t.ann, document.id, file, { beforeStepId: 'nope' }),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      writePreview(t.app, t.ann, document.id, file, {
        original: true,
        beforeStepId: 'nope',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('uses the document’s name in a folder', async () => {
    const document = await newDocument()

    const written = await writePreview(t.app, t.ann, document.id, out)

    expect(written.path).toBe(path.join(out, 'cat.webp'))
  })

  it('says which AI steps are still waiting, so the picture is not taken for finished', async () => {
    const document = await newDocument()
    const step = createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS })
    await addStep(document.id, step)

    const written = await writePreview(
      t.app,
      t.ann,
      document.id,
      path.join(out, 'a.webp'),
    )

    expect(written.pending).toEqual([step.id])
  })

  it('writes the image as opened when asked, as a PNG by its extension', async () => {
    const document = await newDocument()
    await addStep(document.id, createSharpStep('flop'))
    const file = path.join(out, 'before.png')

    const written = await writePreview(t.app, t.ann, document.id, file, {
      original: true,
    })

    expect(written).toMatchObject({
      original: true,
      format: 'png',
      pending: [],
    })
    const meta = await sharp(file).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 8, 6])
  })

  it('makes the picture smaller on request, but never larger', async () => {
    const document = await newDocument()
    const small = path.join(out, 'small.jpg')
    const big = path.join(out, 'big.png')

    await writePreview(t.app, t.ann, document.id, small, {
      original: true,
      width: 4,
    })
    await writePreview(t.app, t.ann, document.id, big, {
      original: true,
      width: 100,
    })

    expect((await sharp(small).metadata()).width).toBe(4)
    expect((await sharp(big).metadata()).width).toBe(8)
  })

  it('writes only the region asked for, taken before the picture is shrunk', async () => {
    const document = await newDocument()
    const half = path.join(out, 'half.png')
    const small = path.join(out, 'small.png')

    const written = await writePreview(t.app, t.ann, document.id, half, {
      original: true,
      region: { x: 0.5, y: 0, width: 0.5, height: 1 },
    })
    await writePreview(t.app, t.ann, document.id, small, {
      original: true,
      region: { x: 0, y: 0, width: 0.5, height: 0.5 },
      width: 2,
    })

    expect(written.region).toEqual({ x: 0.5, y: 0, width: 0.5, height: 1 })
    expect(await sharp(half).metadata()).toMatchObject({ width: 4, height: 6 })
    expect(await sharp(small).metadata()).toMatchObject({ width: 2, height: 2 })
  })

  it('says it wrote the whole picture when no region is given', async () => {
    const document = await newDocument()

    const written = await writePreview(
      t.app,
      t.ann,
      document.id,
      path.join(out, 'all.webp'),
    )

    expect(written.region).toBeNull()
  })

  it('refuses a file type it cannot write', async () => {
    const document = await newDocument()

    await expect(
      writePreview(t.app, t.ann, document.id, path.join(out, 'a.bmp')),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('has nothing to show as opened when the document has no image', async () => {
    const document = await newDocument()
    const view = await t.app.documents.get(t.ann, document.id)
    const layer = view.pipeline.steps[0]
    if (layer === undefined) throw new Error('no layer')
    await t.app.documents.change(t.ann, document.id, view.revision, {
      type: 'remove-step',
      stepId: layer.id,
    })

    await expect(
      writePreview(t.app, t.ann, document.id, path.join(out, 'a.png'), {
        original: true,
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('does not write another person’s document', async () => {
    const document = await newDocument()

    await expect(
      writePreview(t.app, t.bob, document.id, path.join(out, 'a.webp')),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
