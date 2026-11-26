import { describe, expect, it } from 'vitest'

import { canvasOfSize } from '@/features/pipeline/canvas'
import {
  IMAGE_LAYER_KIND,
  createImageLayerStep,
} from '@/features/pipeline/layer-kinds'
import {
  createEmbeddedDocumentStep,
  createGroupStep,
  createPipeline,
  createSharpStep,
  leafSteps,
} from '@/features/pipeline/pipeline'
import {
  CreateFromError,
  ImageChoice,
  documentCanvas,
  documentFromWorkflow,
  embeddedFromWorkflow,
  shownInputImage,
  sourceName,
  workflowFromPipeline,
} from '@/features/workflows/create-from'
import { defaultOutputSettings } from '@/features/workflows/output-settings'
import { CanvasSize, createWorkflow } from '@/features/workflows/workflow'
import type { WorkflowDefinition } from '@/features/workflows/workflow'

const CANVAS = { ...canvasOfSize(640, 480), background: '#112233' }

function documentPipeline() {
  const base = createImageLayerStep('src-photo')
  const logo = createImageLayerStep('src-logo')
  const deep = createImageLayerStep('src-deep')
  const blur = createSharpStep('blur', { sigma: 2 })
  const badge = createEmbeddedDocumentStep(
    [createGroupStep([deep, blur], 'Soft')],
    'Badge',
  )
  return {
    base,
    logo,
    deep,
    blur,
    badge,
    pipeline: createPipeline(CANVAS, [base, logo, badge]),
  }
}

function images(definition: WorkflowDefinition): Array<string | undefined> {
  const found: Array<string | undefined> = []
  for (const step of leafSteps(definition.pipeline)) {
    if (step.kind === IMAGE_LAYER_KIND) found.push(step.sourceId)
  }
  return found
}

describe('a workflow from a document', () => {
  it('keeps every image, on a set-size canvas the document’s, with no inputs and the default output', () => {
    const { pipeline } = documentPipeline()

    const definition = workflowFromPipeline(pipeline, {
      images: ImageChoice.Keep,
    })

    expect(images(definition)).toEqual(['src-photo', 'src-logo', 'src-deep'])
    expect(definition.canvasSize).toBe(CanvasSize.Fixed)
    expect(definition.pipeline.canvas).toEqual(CANVAS)
    expect(definition.inputs).toEqual([])
    expect(definition.output).toEqual(defaultOutputSettings())
  })

  it('removes every image at any depth and makes them the inputs, each once', () => {
    const { pipeline, base } = documentPipeline()
    const again = createPipeline(CANVAS, [
      ...pipeline.steps,
      createImageLayerStep(base.sourceId),
    ])

    const definition = workflowFromPipeline(again, {
      images: ImageChoice.Remove,
    })

    expect(images(definition)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ])
    expect(definition.inputs).toEqual(['src-photo', 'src-logo', 'src-deep'])
  })

  it('removes only the input image, the first image layer’s, and makes it the input', () => {
    const { pipeline } = documentPipeline()

    const definition = workflowFromPipeline(pipeline, {
      images: ImageChoice.RemoveInput,
    })

    expect(images(definition)).toEqual([undefined, 'src-logo', 'src-deep'])
    expect(definition.inputs).toEqual(['src-photo'])
  })

  it('copies every step under new ids, keeping groups and embedded document layers', () => {
    const { pipeline, badge, blur } = documentPipeline()

    const definition = workflowFromPipeline(pipeline, {
      images: ImageChoice.Keep,
    })

    const ids = leafSteps(definition.pipeline).map(({ id }) => id)
    expect(ids).not.toContain(blur.id)
    expect(definition.pipeline.steps[2]).toMatchObject({
      kind: 'embedded-document',
      name: 'Badge',
      steps: [{ kind: 'group', name: 'Soft' }],
    })
    expect(definition.pipeline.steps[2]?.id).not.toBe(badge.id)
  })

  it('takes a group’s or embedded document layer’s steps as the top level, on the parent’s canvas, without its placement', () => {
    const { pipeline, badge } = documentPipeline()

    const definition = workflowFromPipeline(pipeline, {
      images: ImageChoice.RemoveInput,
      containerId: badge.id,
    })

    expect(definition.pipeline.canvas).toEqual(CANVAS)
    expect(definition.pipeline.steps).toHaveLength(1)
    expect(definition.pipeline.steps[0]).toMatchObject({
      kind: 'group',
      name: 'Soft',
    })
    expect(definition.pipeline.steps[0]).not.toHaveProperty('opacity')
    expect(definition.inputs).toEqual(['src-deep'])
  })

  it('puts an empty image layer first, as the input slot, when the steps have none', () => {
    const blur = createSharpStep('blur')
    const group = createGroupStep([blur])
    const pipeline = createPipeline(CANVAS, [
      createImageLayerStep('src-a'),
      group,
    ])

    const definition = workflowFromPipeline(pipeline, {
      images: ImageChoice.Keep,
      containerId: group.id,
    })

    expect(definition.pipeline.steps[0]).toMatchObject({
      kind: IMAGE_LAYER_KIND,
    })
    expect(definition.pipeline.steps[0]).not.toHaveProperty('sourceId')
    expect(definition.pipeline.steps[1]).toMatchObject({ op: 'blur' })
  })

  it('refuses a source step that is not a group or embedded document layer, or is not there', () => {
    const { pipeline, base } = documentPipeline()

    expect(() =>
      workflowFromPipeline(pipeline, {
        images: ImageChoice.Keep,
        containerId: base.id,
      }),
    ).toThrow(CreateFromError)
    expect(() =>
      workflowFromPipeline(pipeline, {
        images: ImageChoice.Keep,
        containerId: crypto.randomUUID(),
      }),
    ).toThrow(CreateFromError)
  })
})

function workflowWith(
  steps: Parameters<typeof createPipeline>[1],
  overrides: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
  const { id: _id, name: _name, ...definition } = createWorkflow('W', CANVAS)
  return {
    ...definition,
    pipeline: createPipeline(CANVAS, steps),
    ...overrides,
  }
}

describe('a document from a workflow', () => {
  it('shows the last input image added, or the slot’s own image when there are none', () => {
    const slot = createImageLayerStep('src-slot')
    expect(
      shownInputImage(workflowWith([slot], { inputs: ['src-a', 'src-b'] })),
    ).toBe('src-b')
    expect(shownInputImage(workflowWith([slot]))).toBe('src-slot')
    expect(
      shownInputImage(workflowWith([createImageLayerStep()])),
    ).toBeUndefined()
  })

  it('makes the input slot a plain image layer holding the shown image, and copies every other step as it is', () => {
    const slot = createImageLayerStep()
    const logo = createImageLayerStep('src-logo')
    const blur = createSharpStep('blur', { sigma: 4 })
    const definition = workflowWith([slot, blur, logo], { inputs: ['src-a'] })

    const pipeline = documentFromWorkflow(definition, { canvas: CANVAS })

    expect(pipeline.canvas).toEqual(CANVAS)
    expect(pipeline.steps).toMatchObject([
      { kind: IMAGE_LAYER_KIND, sourceId: 'src-a' },
      { kind: 'sharp', op: 'blur', options: { sigma: 4 } },
      { kind: IMAGE_LAYER_KIND, sourceId: 'src-logo' },
    ])
    expect(pipeline.steps[1]?.id).not.toBe(blur.id)
  })

  it('leaves the slot empty when there is no input image', () => {
    const definition = workflowWith([createImageLayerStep()])

    const pipeline = documentFromWorkflow(definition, { canvas: CANVAS })

    expect(pipeline.steps[0]).not.toHaveProperty('sourceId')
  })

  it('takes a container’s steps as the top level, with the slot inside it filled', () => {
    const slot = createImageLayerStep()
    const badge = createEmbeddedDocumentStep([slot, createSharpStep('flip')])
    const definition = workflowWith([badge], { inputs: ['src-a'] })

    const pipeline = documentFromWorkflow(definition, {
      canvas: CANVAS,
      containerId: badge.id,
    })

    expect(pipeline.steps).toMatchObject([
      { kind: IMAGE_LAYER_KIND, sourceId: 'src-a' },
      { kind: 'sharp', op: 'flip' },
    ])
  })
})

describe('the name a new item starts from', () => {
  it('is the container’s name, or the source’s when it has none or none is chosen', () => {
    const { pipeline, badge } = documentPipeline()
    const unnamed = createGroupStep([])
    const withUnnamed = createPipeline(CANVAS, [...pipeline.steps, unnamed])

    expect(sourceName(pipeline, badge.id, 'Poster')).toBe('Badge')
    expect(sourceName(withUnnamed, unnamed.id, 'Poster')).toBe('Poster')
    expect(sourceName(pipeline, undefined, 'Poster')).toBe('Poster')
  })
})

describe('the canvas of a document from a workflow', () => {
  it('is the workflow’s when its size is set', () => {
    const definition = workflowWith([createImageLayerStep()], {
      canvasSize: CanvasSize.Fixed,
    })
    expect(documentCanvas(definition, undefined, undefined)).toEqual(CANVAS)
  })

  it('is the shown image’s size with the workflow’s background when it matches each input', () => {
    const definition = workflowWith([createImageLayerStep()], {
      canvasSize: CanvasSize.MatchInput,
    })
    expect(
      documentCanvas(definition, { width: 300, height: 200 }, undefined),
    ).toEqual({ width: 300, height: 200, background: '#112233' })
  })

  it('needs a size when it matches each input and there is no image, and takes the one given', () => {
    const definition = workflowWith([createImageLayerStep()], {
      canvasSize: CanvasSize.MatchInput,
    })
    expect(() => documentCanvas(definition, undefined, undefined)).toThrow(
      CreateFromError,
    )
    expect(
      documentCanvas(definition, undefined, { width: 50, height: 40 }),
    ).toEqual({ width: 50, height: 40, background: '#112233' })
  })

  it('refuses a size when the workflow already decides it', () => {
    const fixed = workflowWith([createImageLayerStep()], {
      canvasSize: CanvasSize.Fixed,
    })
    expect(() =>
      documentCanvas(fixed, undefined, { width: 50, height: 40 }),
    ).toThrow(CreateFromError)
    const matched = workflowWith([createImageLayerStep()], {
      canvasSize: CanvasSize.MatchInput,
    })
    expect(() =>
      documentCanvas(
        matched,
        { width: 300, height: 200 },
        { width: 50, height: 40 },
      ),
    ).toThrow(CreateFromError)
  })
})

describe('a workflow added to a document', () => {
  it('is an embedded document layer named after the workflow, a copy with the image chosen in its input slot', () => {
    const slot = createImageLayerStep('src-slot')
    const logo = createImageLayerStep('src-logo')
    const blur = createSharpStep('blur')
    const definition = workflowWith([slot, blur, logo], { inputs: ['src-a'] })

    const embedded = embeddedFromWorkflow(definition, 'Brand', 'src-chosen')

    expect(embedded).toMatchObject({
      kind: 'embedded-document',
      name: 'Brand',
      enabled: true,
      opacity: 100,
      steps: [
        { kind: IMAGE_LAYER_KIND, sourceId: 'src-chosen' },
        { kind: 'sharp', op: 'blur' },
        { kind: IMAGE_LAYER_KIND, sourceId: 'src-logo' },
      ],
    })
    expect(embedded.steps[1]?.id).not.toBe(blur.id)
  })

  it('leaves the input slot empty when no image is chosen', () => {
    const definition = workflowWith([createImageLayerStep('src-slot')], {
      inputs: ['src-a'],
    })

    const embedded = embeddedFromWorkflow(definition, 'Brand', undefined)

    expect(embedded.steps[0]).not.toHaveProperty('sourceId')
  })
})
