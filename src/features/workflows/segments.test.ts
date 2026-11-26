import { describe, expect, it } from 'vitest'

import { AiToolId } from '@/features/ai/ai-tools'
import { canvasOfSize } from '@/features/pipeline/canvas'
import { createImageLayerStep } from '@/features/pipeline/layer-kinds'
import {
  createAiStep,
  createEmbeddedDocumentStep,
  createGroupStep,
  createPipeline,
  createSharpStep,
} from '@/features/pipeline/pipeline'
import type { PipelineStep } from '@/features/pipeline/pipeline'
import {
  fillInputSlot,
  inputSlot,
  itemPipeline,
  workflowLayerPipeline,
  workflowProblem,
} from '@/features/workflows/segments'
import { CanvasSize, createWorkflow } from '@/features/workflows/workflow'
import type { WorkflowDefinition } from '@/features/workflows/workflow'

const UPSCALE = {
  tool: AiToolId.Upscale,
  settings: { model: 'm', scale: 4, iterations: 1, tta: false },
} as const

function definition(
  steps: ReadonlyArray<PipelineStep>,
  inputs: string[] = ['src-1'],
): WorkflowDefinition {
  const { id: _id, name: _name, ...rest } = createWorkflow('Test')
  return {
    ...rest,
    pipeline: createPipeline(canvasOfSize(100, 50), steps),
    inputs,
  }
}

function pipelineOf(...steps: ReadonlyArray<PipelineStep>) {
  return createPipeline(canvasOfSize(1, 1), steps)
}

describe('inputSlot', () => {
  it('is the first image layer that is on, with or without an image', () => {
    const fixed = createImageLayerStep('fixed')
    const steps = [
      createSharpStep('blur'),
      { ...createImageLayerStep(), enabled: false },
      fixed,
      createImageLayerStep(),
    ]

    expect(inputSlot(pipelineOf(...steps))).toEqual(fixed)
  })

  it('is found at any depth of groups and embedded document layers, and not under one that is off', () => {
    const hidden = createImageLayerStep()
    const inside = createImageLayerStep()
    const off = { ...createGroupStep([hidden]), enabled: false }
    const embedded = createEmbeddedDocumentStep([
      createGroupStep([createGroupStep([inside])]),
    ])

    expect(
      inputSlot(pipelineOf(off, embedded, createImageLayerStep())),
    ).toEqual(inside)
  })

  it('is undefined for a pipeline with no image layer that is on', () => {
    expect(inputSlot(pipelineOf(createSharpStep('blur')))).toBeUndefined()
  })
})

describe('fillInputSlot', () => {
  it('puts the image in the slot, replacing the one it had, and leaves the other layers as they are', () => {
    const first = createImageLayerStep('placeholder')
    const logo = createImageLayerStep('logo')
    const pipeline = pipelineOf(first, logo)

    const filled = fillInputSlot(pipeline, 'src-9')

    expect(filled.steps[0]).toMatchObject({ id: first.id, sourceId: 'src-9' })
    expect(filled.steps[1]).toEqual(logo)
  })

  it('fills a slot inside an embedded document layer', () => {
    const inside = createImageLayerStep()
    const embedded = createEmbeddedDocumentStep([inside])

    const filled = fillInputSlot(pipelineOf(embedded), 'src-9')

    expect(filled.steps[0]).toMatchObject({
      steps: [{ id: inside.id, sourceId: 'src-9' }],
    })
  })

  it('refuses a pipeline with no slot', () => {
    expect(() => fillInputSlot(pipelineOf(), 'a')).toThrow(
      /no place for an input image/,
    )
  })
})

describe('itemPipeline', () => {
  const image = { id: 'src-9', width: 640, height: 480 }
  const layer = createImageLayerStep()
  const base = definition([layer])

  it('keeps the size set on the canvas for a fixed canvas', () => {
    const pipeline = itemPipeline(
      { ...base, canvasSize: CanvasSize.Fixed },
      image,
    )

    expect(pipeline.canvas).toEqual(base.pipeline.canvas)
    expect(pipeline.steps[0]).toMatchObject({ sourceId: 'src-9' })
  })

  it('takes the size of the image, and keeps the background, when it matches each input image', () => {
    const coloured = {
      ...base,
      canvasSize: CanvasSize.MatchInput,
      pipeline: {
        ...base.pipeline,
        canvas: { width: 10, height: 10, background: '#ff0000' },
      },
    }

    expect(itemPipeline(coloured, image).canvas).toEqual({
      width: 640,
      height: 480,
      background: '#ff0000',
    })
  })
})

describe('workflowProblem', () => {
  const slot = createImageLayerStep()

  it('is undefined for a workflow with an input and a slot', () => {
    expect(workflowProblem(definition([slot]))).toBeUndefined()
    expect(
      workflowProblem(definition([createImageLayerStep('placeholder')])),
    ).toBeUndefined()
  })

  it('asks for an input image', () => {
    expect(workflowProblem(definition([slot], []))).toBe(
      'Add at least one image to run the workflow on.',
    )
  })

  it('asks for an image layer when there is none that is on', () => {
    expect(workflowProblem(definition([createSharpStep('blur')]))).toBe(
      'Add an image layer: each input image goes in the first one.',
    )
  })

  it('runs AI steps inside embedded document layers', () => {
    const embedded = createEmbeddedDocumentStep([slot, createAiStep(UPSCALE)])

    expect(workflowProblem(definition([embedded]))).toBeUndefined()
  })
})

describe('the pipeline a workflow layer draws', () => {
  it('is the workflow on the layer’s image, at the size its canvas mode gives', () => {
    const matched = {
      ...definition([
        createImageLayerStep('src-slot'),
        createSharpStep('flip'),
      ]),
      canvasSize: CanvasSize.MatchInput,
    }

    const pipeline = workflowLayerPipeline(matched, {
      id: 'src-layer',
      width: 30,
      height: 20,
    })

    expect(pipeline.canvas).toMatchObject({ width: 30, height: 20 })
    expect(pipeline.steps[0]).toMatchObject({ sourceId: 'src-layer' })
  })

  it('draws without an input when the layer has no image: the slot is empty, on the workflow’s canvas', () => {
    const fixed = {
      ...definition([createImageLayerStep('src-slot')]),
      canvasSize: CanvasSize.Fixed,
    }

    const pipeline = workflowLayerPipeline(fixed, undefined)

    expect(pipeline.canvas).toMatchObject({ width: 100, height: 50 })
    expect(pipeline.steps[0]).not.toHaveProperty('sourceId')
  })
})
