// @vitest-environment node
import path from 'node:path'

import sharp from 'sharp'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AiToolId } from '@/features/ai/ai-tools'
import { canvasOfSize } from '@/features/pipeline/canvas'
import {
  createDocumentLayerStep,
  createImageLayerStep,
  createWorkflowLayerStep,
} from '@/features/pipeline/layer-kinds'
import {
  createAiStep,
  createPipeline,
  createSharpStep,
} from '@/features/pipeline/pipeline'
import type { PipelineStep } from '@/features/pipeline/pipeline'
import { CanvasSize, createWorkflow } from '@/features/workflows/workflow'

import { ZipWriter, openZip } from '../bundle/zip.ts'
import { ValidationError } from '../errors.ts'
import { isTerminal } from '../jobs/job-types.ts'
import { createTestApp } from '../testing/test-app.ts'
import type { TestApp } from '../testing/test-app.ts'

const CANVAS = canvasOfSize(20, 10)

let t: TestApp

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

function document(name: string, steps: PipelineStep[]) {
  return t.app.documents.createFromPipeline(
    t.ann,
    name,
    createPipeline(CANVAS, steps),
  )
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

/** Poster: a document layer drawing Card, which draws Badge (with a logo), and a workflow layer drawing Brand on a photo. */
async function poster() {
  const logo = await t.uploadImage(t.ann, '#cc0000', 'logo.png')
  const photo = await t.uploadImage(t.ann, '#336699', 'photo.png')
  const badge = await document('Badge', [createImageLayerStep(logo.id)])
  const card = await document('Card', [createDocumentLayerStep(badge.id)])
  const { pipeline, output } = createWorkflow('x', CANVAS)
  const brand = await t.app.workflows.create(t.ann, 'Brand', {
    pipeline: createPipeline(CANVAS, [
      ...pipeline.steps,
      createSharpStep('flip'),
    ]),
    canvasSize: CanvasSize.Fixed,
    inputs: [photo.id],
    output,
  })
  const holder = await document('Poster', [
    createDocumentLayerStep(card.id),
    createWorkflowLayerStep(brand.id, photo.id),
  ])
  return { logo, photo, badge, card, brand, holder }
}

describe('a document file with layers that use other items', () => {
  it('carries every document and workflow they use, however deep, and import makes them the new User’s', async () => {
    const { card, brand, holder } = await poster()
    const bundle = file('poster.lemon')

    await t.app.bundles.exportDocument(t.ann, holder.id, bundle)
    const imported = await t.app.bundles.importDocument(t.bob, bundle)

    const [cardLayer, brandLayer] = imported.document.pipeline.steps
    expect(cardLayer).toMatchObject({ kind: 'document-layer' })
    expect(brandLayer).toMatchObject({ kind: 'workflow-layer' })
    if (cardLayer?.kind !== 'document-layer') throw new Error('not a layer')
    if (brandLayer?.kind !== 'workflow-layer') throw new Error('not a layer')
    expect(cardLayer.documentId).not.toBe(card.id)
    expect(brandLayer.workflowId).not.toBe(brand.id)

    const theirCard = await t.app.documents.get(t.bob, cardLayer.documentId)
    expect(theirCard.name).toBe('Card')
    const badgeLayer = theirCard.pipeline.steps[0]
    if (badgeLayer?.kind !== 'document-layer') throw new Error('not a layer')
    const theirBadge = await t.app.documents.get(t.bob, badgeLayer.documentId)
    expect(theirBadge.name).toBe('Badge')
    expect(theirBadge.sources.map(({ fileName }) => fileName)).toEqual([
      'logo.png',
    ])

    const theirBrand = await t.app.workflows.get(t.bob, brandLayer.workflowId)
    expect(theirBrand.name).toBe('Brand')
    expect(theirBrand.inputs).toHaveLength(1)
    expect(brandLayer.sourceId).toBe(theirBrand.inputs[0])
    expect(await t.app.documents.list(t.bob)).toHaveLength(3)
  })

  it('always makes new items on import, with workflow names made unique', async () => {
    const { holder } = await poster()
    const bundle = file('poster.lemon')
    await t.app.bundles.exportDocument(t.ann, holder.id, bundle)

    await t.app.bundles.importDocument(t.ann, bundle)

    expect(await t.app.documents.list(t.ann)).toHaveLength(6)
    const names = (await t.app.workflows.list(t.ann)).map(({ name }) => name)
    expect(names.sort()).toEqual(['Brand', 'Brand 2'])
  })

  it('refuses a file whose layer uses an item it does not hold, keeping nothing', async () => {
    const { holder } = await poster()
    const bundle = file('poster.lemon')
    await t.app.bundles.exportDocument(t.ann, holder.id, bundle)
    const archive = await openZip(bundle)
    const manifest = JSON.parse(
      (await archive.read('manifest.json', 1024 * 1024)).toString('utf8'),
    )
    const objects = archive.entries.filter(
      ({ name }) => name !== 'manifest.json',
    )
    const writer = await ZipWriter.create(file('broken.lemon'))
    await writer.addBuffer(
      'manifest.json',
      Buffer.from(JSON.stringify({ ...manifest, workflows: [] })),
    )
    for (const { name } of objects) {
      await writer.addBuffer(name, await archive.read(name, 1024 * 1024))
    }
    await writer.close()
    await archive.close()

    await expect(
      t.app.bundles.importDocument(t.bob, file('broken.lemon')),
    ).rejects.toThrow(ValidationError)
    expect(await t.app.documents.list(t.bob)).toEqual([])
    expect(await t.app.workflows.list(t.bob)).toEqual([])
    expect(await t.app.sources.list(t.bob)).toEqual([])
  })

  it('keeps the AI results of a used document with the new copy of it, so deleting the holder keeps them', async () => {
    const logo = await t.uploadImage(t.ann, '#cc0000', 'logo.png')
    const upscale = createAiStep({
      tool: AiToolId.Upscale,
      settings: { model: 'm', scale: 4, iterations: 1, tta: false },
    })
    const badge = await document('Badge', [
      createImageLayerStep(logo.id),
      upscale,
    ])
    const holder = await document('Poster', [createDocumentLayerStep(badge.id)])
    await runAiStep(holder.id, upscale.id)
    const bundle = file('poster.lemon')

    const exported = await t.app.bundles.exportDocument(
      t.ann,
      holder.id,
      bundle,
    )
    const imported = await t.app.bundles.importDocument(t.bob, bundle)

    expect(exported.results).toBe(1)
    expect(imported.summary.results).toMatchObject({ imported: 1 })
    const layer = imported.document.pipeline.steps[0]
    if (layer?.kind !== 'document-layer') throw new Error('not a layer')
    const [result] = await t.app.results.list(t.bob)
    expect(result).toMatchObject({
      documentId: layer.documentId,
      stepId: upscale.id,
    })

    await t.app.documents.delete(t.bob, imported.document.id)

    expect(await t.app.results.list(t.bob)).toHaveLength(1)
  })

  it('carries the Result of each use of a workflow used twice, and import keeps both', async () => {
    const one = await t.uploadImage(t.ann, '#111111', 'one.png')
    const two = await t.uploadImage(t.ann, '#222222', 'two.png')
    const upscale = createAiStep({
      tool: AiToolId.Upscale,
      settings: { model: 'm', scale: 4, iterations: 1, tta: false },
    })
    const { pipeline, output } = createWorkflow('x', CANVAS)
    const brand = await t.app.workflows.create(t.ann, 'Brand', {
      pipeline: createPipeline(CANVAS, [...pipeline.steps, upscale]),
      canvasSize: CanvasSize.Fixed,
      inputs: [],
      output,
    })
    const holder = await document('Poster', [
      createWorkflowLayerStep(brand.id, one.id),
      createWorkflowLayerStep(brand.id, two.id),
    ])
    await runAiStep(holder.id, upscale.id)
    await runAiStep(holder.id, upscale.id)
    const bundle = file('twice.lemon')

    const exported = await t.app.bundles.exportDocument(
      t.ann,
      holder.id,
      bundle,
    )
    const imported = await t.app.bundles.importDocument(t.bob, bundle)

    expect(exported.results).toBe(2)
    expect(imported.summary.results).toMatchObject({ imported: 2 })
    const results = await t.app.results.list(t.bob)
    expect(results.map(({ documentId }) => documentId)).toEqual([
      imported.document.id,
      imported.document.id,
    ])
  })
})
