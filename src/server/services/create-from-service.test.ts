import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { canvasOfSize } from '@/features/pipeline/canvas'
import { createImageLayerStep } from '@/features/pipeline/layer-kinds'
import {
  createEmbeddedDocumentStep,
  createPipeline,
  createSharpStep,
} from '@/features/pipeline/pipeline'
import { ImageChoice } from '@/features/workflows/create-from'
import { CanvasSize, createWorkflow } from '@/features/workflows/workflow'

import { NotFoundError, ValidationError } from '../errors.ts'
import { createTestApp } from '../testing/test-app.ts'
import type { TestApp } from '../testing/test-app.ts'

const CANVAS = { ...canvasOfSize(40, 30), background: '#102030' }

let t: TestApp

beforeEach(async () => {
  t = await createTestApp()
})

afterEach(async () => {
  await t.close()
})

async function documentWithImages(name = 'Poster') {
  const photo = await t.uploadImage(t.ann, '#ff0000', 'photo.png')
  const logo = await t.uploadImage(t.ann, '#00ff00', 'logo.png')
  const badge = createEmbeddedDocumentStep([createSharpStep('flip')], 'Badge')
  const document = await t.app.documents.createFromPipeline(
    t.ann,
    name,
    createPipeline(CANVAS, [
      createImageLayerStep(photo.id),
      createImageLayerStep(logo.id),
      badge,
    ]),
  )
  return { photo, logo, badge, document }
}

describe('a new workflow from a document', () => {
  it('is named after the document, removes the input image and makes it the input', async () => {
    const { document, photo, logo } = await documentWithImages()

    const workflow = await t.app.createFrom.workflowFromDocument(
      t.ann,
      document.id,
      { images: ImageChoice.RemoveInput },
    )

    expect(workflow.name).toBe('Poster')
    expect(workflow.inputs).toEqual([photo.id])
    expect(workflow.canvasSize).toBe(CanvasSize.Fixed)
    expect(workflow.pipeline.canvas).toEqual(CANVAS)
    expect(workflow.pipeline.steps[0]).not.toHaveProperty('sourceId')
    expect(workflow.pipeline.steps[1]).toMatchObject({ sourceId: logo.id })
    expect(await t.app.workflows.get(t.ann, workflow.id)).toMatchObject({
      name: 'Poster',
    })
  })

  it('makes the name unique, or takes the one given', async () => {
    const { document } = await documentWithImages()
    await t.app.workflows.create(t.ann, 'Poster')

    const numbered = await t.app.createFrom.workflowFromDocument(
      t.ann,
      document.id,
      { images: ImageChoice.Keep },
    )
    const named = await t.app.createFrom.workflowFromDocument(
      t.ann,
      document.id,
      { images: ImageChoice.Keep, name: 'Mine' },
    )

    expect(numbered.name).toBe('Poster 2')
    expect(named.name).toBe('Mine')
  })

  it('starts from an embedded document layer’s steps, named after it', async () => {
    const { document, badge } = await documentWithImages()

    const workflow = await t.app.createFrom.workflowFromDocument(
      t.ann,
      document.id,
      { images: ImageChoice.Remove, stepId: badge.id },
    )

    expect(workflow.name).toBe('Badge')
    expect(workflow.inputs).toEqual([])
    expect(workflow.pipeline.steps).toMatchObject([
      { kind: 'image-layer' },
      { kind: 'sharp', op: 'flip' },
    ])
  })

  it('refuses another User’s document, and a step that is not a container', async () => {
    const { document, photo } = await documentWithImages()
    const layerId = (await t.app.documents.get(t.ann, document.id)).pipeline
      .steps[0]?.id

    await expect(
      t.app.createFrom.workflowFromDocument(t.bob, document.id, {
        images: ImageChoice.Keep,
      }),
    ).rejects.toThrow(NotFoundError)
    await expect(
      t.app.createFrom.workflowFromDocument(t.ann, document.id, {
        images: ImageChoice.Keep,
        stepId: layerId,
      }),
    ).rejects.toThrow(ValidationError)
    expect(photo.id).toBeDefined()
  })
})

describe('a new document from a workflow', () => {
  async function workflowWith(canvasSize: CanvasSize, inputs: string[]) {
    const { pipeline, output } = createWorkflow('x', CANVAS)
    return t.app.workflows.create(t.ann, 'Resize all', {
      pipeline: createPipeline(CANVAS, [
        ...pipeline.steps,
        createSharpStep('flip'),
      ]),
      canvasSize,
      inputs,
      output,
    })
  }

  it('puts the last input image in the slot, on the workflow’s set canvas', async () => {
    const first = await t.uploadImage(t.ann, '#ff0000')
    const last = await t.uploadImage(t.ann, '#0000ff')
    const workflow = await workflowWith(CanvasSize.Fixed, [first.id, last.id])

    const document = await t.app.createFrom.documentFromWorkflow(
      t.ann,
      workflow.id,
      {},
    )

    expect(document.name).toBe('Resize all')
    expect(document.pipeline.canvas).toEqual(CANVAS)
    expect(document.pipeline.steps).toMatchObject([
      { kind: 'image-layer', sourceId: last.id },
      { kind: 'sharp', op: 'flip' },
    ])
  })

  it('takes the input image’s size when the workflow matches each input', async () => {
    const image = await t.uploadImage(t.ann, '#ff0000')
    const workflow = await workflowWith(CanvasSize.MatchInput, [image.id])

    const document = await t.app.createFrom.documentFromWorkflow(
      t.ann,
      workflow.id,
      { name: 'One' },
    )

    expect(document.name).toBe('One')
    expect(document.pipeline.canvas).toEqual({
      width: image.width,
      height: image.height,
      background: CANVAS.background,
    })
  })

  it('needs a size when the workflow matches each input and has none', async () => {
    const workflow = await workflowWith(CanvasSize.MatchInput, [])

    await expect(
      t.app.createFrom.documentFromWorkflow(t.ann, workflow.id, {}),
    ).rejects.toThrow(ValidationError)
    const document = await t.app.createFrom.documentFromWorkflow(
      t.ann,
      workflow.id,
      { size: { width: 12, height: 9 } },
    )
    expect(document.pipeline.canvas).toMatchObject({ width: 12, height: 9 })
  })

  it('refuses another User’s workflow', async () => {
    const workflow = await workflowWith(CanvasSize.Fixed, [])
    await expect(
      t.app.createFrom.documentFromWorkflow(t.bob, workflow.id, {}),
    ).rejects.toThrow(NotFoundError)
  })
})

describe('a workflow added to a document', () => {
  async function workflowNamed(name: string) {
    const { pipeline, output } = createWorkflow('x', CANVAS)
    return t.app.workflows.create(t.ann, name, {
      pipeline: createPipeline(CANVAS, [
        ...pipeline.steps,
        createSharpStep('flip'),
      ]),
      canvasSize: CanvasSize.Fixed,
      inputs: [],
      output,
    })
  }

  it('goes at the end as an embedded document layer named after it, with the chosen image, as one undoable change', async () => {
    const { document } = await documentWithImages()
    const workflow = await workflowNamed('Brand')
    const image = await t.uploadImage(t.ann, '#0000ff')

    const changed = await t.app.createFrom.insertWorkflow(
      t.ann,
      document.id,
      document.revision,
      { workflowId: workflow.id, sourceId: image.id },
    )

    expect(changed.pipeline.steps.at(-1)).toMatchObject({
      kind: 'embedded-document',
      name: 'Brand',
      steps: [
        { kind: 'image-layer', sourceId: image.id },
        { kind: 'sharp', op: 'flip' },
      ],
    })
    const undone = await t.app.documents.undo(
      t.ann,
      document.id,
      changed.revision,
    )
    expect(undone.pipeline.steps).toHaveLength(document.pipeline.steps.length)
  })

  it('goes after the step given, and leaves the slot empty with no image', async () => {
    const { document } = await documentWithImages()
    const workflow = await workflowNamed('Brand')
    const first = document.pipeline.steps[0]?.id

    const changed = await t.app.createFrom.insertWorkflow(
      t.ann,
      document.id,
      document.revision,
      { workflowId: workflow.id, afterStepId: first },
    )

    expect(changed.pipeline.steps[1]).toMatchObject({
      kind: 'embedded-document',
    })
    const embedded = changed.pipeline.steps[1]
    const slot =
      embedded !== undefined && 'steps' in embedded
        ? embedded.steps[0]
        : undefined
    expect(slot).not.toHaveProperty('sourceId')
  })

  it('refuses another User’s workflow and image', async () => {
    const { document } = await documentWithImages()
    const workflow = await workflowNamed('Brand')
    const foreign = await t.uploadImage(t.bob, '#123456')

    await expect(
      t.app.createFrom.insertWorkflow(t.bob, document.id, document.revision, {
        workflowId: workflow.id,
      }),
    ).rejects.toThrow(NotFoundError)
    await expect(
      t.app.createFrom.insertWorkflow(t.ann, document.id, document.revision, {
        workflowId: workflow.id,
        sourceId: foreign.id,
      }),
    ).rejects.toThrow(NotFoundError)
  })
})

describe('a workflow as the embedded document layer it becomes', () => {
  it('is named after the workflow with the image in its slot, and refuses another User’s image', async () => {
    const { pipeline, output } = createWorkflow('x', CANVAS)
    const workflow = await t.app.workflows.create(t.ann, 'Brand', {
      pipeline,
      canvasSize: CanvasSize.Fixed,
      inputs: [],
      output,
    })
    const image = await t.uploadImage(t.ann, '#0000ff')
    const foreign = await t.uploadImage(t.bob, '#123456')

    const step = await t.app.createFrom.workflowAsEmbedded(
      t.ann,
      workflow.id,
      image.id,
    )

    expect(step).toMatchObject({
      kind: 'embedded-document',
      name: 'Brand',
      steps: [{ kind: 'image-layer', sourceId: image.id }],
    })
    await expect(
      t.app.createFrom.workflowAsEmbedded(t.ann, workflow.id, foreign.id),
    ).rejects.toThrow(NotFoundError)
  })
})
