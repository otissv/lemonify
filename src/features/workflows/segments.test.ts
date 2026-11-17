import { describe, expect, it } from 'vitest'

import { AiToolId } from '@/features/ai/ai-tools'
import { canvasOfSize } from '@/features/pipeline/canvas'
import { createImageLayerStep } from '@/features/pipeline/layer-kinds'
import {
  createAiStep,
  createGroupStep,
  createPipeline,
  createSharpStep,
} from '@/features/pipeline/pipeline'
import type { PipelineStep } from '@/features/pipeline/pipeline'
import {
  fillFirstSlot,
  inputSlots,
  itemPipeline,
  planSegments,
  workflowProblem,
} from '@/features/workflows/segments'
import { RunCanvasMode, createWorkflow } from '@/features/workflows/workflow'
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

describe('inputSlots', () => {
  it('are the image layers that are on and have no image, in pipeline order', () => {
    const first = createImageLayerStep()
    const second = createImageLayerStep()
    const steps = [
      createSharpStep('blur'),
      first,
      createImageLayerStep('fixed'),
      { ...createImageLayerStep(), enabled: false },
      second,
    ]

    expect(inputSlots(createPipeline(canvasOfSize(1, 1), steps))).toEqual([
      first,
      second,
    ])
  })

  it('are found in groups and sub-documents, and not in a group that is off', () => {
    const inside = createImageLayerStep()
    const hidden = createImageLayerStep()
    const group = { ...createGroupStep([inside]), subDocument: true }
    const off = { ...createGroupStep([hidden]), enabled: false }

    expect(
      inputSlots(createPipeline(canvasOfSize(1, 1), [group, off])),
    ).toEqual([inside])
  })
})

describe('fillFirstSlot', () => {
  it('puts the image in the first slot and leaves the others empty', () => {
    const first = createImageLayerStep()
    const second = createImageLayerStep()
    const pipeline = createPipeline(canvasOfSize(1, 1), [first, second])

    const filled = fillFirstSlot(pipeline, 'src-9')

    expect(filled.steps[0]).toMatchObject({ id: first.id, sourceId: 'src-9' })
    expect(filled.steps[1]).not.toHaveProperty('sourceId')
  })

  it('refuses a pipeline with no slot', () => {
    expect(() =>
      fillFirstSlot(createPipeline(canvasOfSize(1, 1), []), 'a'),
    ).toThrow(/no place for an input image/)
  })
})

describe('itemPipeline', () => {
  const image = { id: 'src-9', width: 640, height: 480 }
  const layer = createImageLayerStep()
  const base = definition([layer])

  it('keeps the workflow canvas by default', () => {
    const pipeline = itemPipeline(base, RunCanvasMode.Workflow, image)

    expect(pipeline.canvas).toEqual(base.pipeline.canvas)
    expect(pipeline.steps[0]).toMatchObject({ sourceId: 'src-9' })
  })

  it('takes the size of the image, and keeps the background, for first-image', () => {
    const coloured = {
      ...base,
      pipeline: {
        ...base.pipeline,
        canvas: { width: 10, height: 10, background: '#ff0000' },
      },
    }

    expect(
      itemPipeline(coloured, RunCanvasMode.FirstImage, image).canvas,
    ).toEqual({ width: 640, height: 480, background: '#ff0000' })
  })
})

describe('planSegments', () => {
  it('is one empty draw segment for a pipeline with no steps', () => {
    expect(planSegments(createPipeline(canvasOfSize(1, 1)))).toEqual([
      { kind: 'draw', steps: [] },
    ])
  })

  it('keeps layers and Sharp steps together in one draw segment', () => {
    const layer = createImageLayerStep('a')
    const blur = createSharpStep('blur')

    expect(
      planSegments(createPipeline(canvasOfSize(1, 1), [layer, blur])),
    ).toEqual([{ kind: 'draw', steps: [layer, blur] }])
  })

  it('puts an AI step in its own segment, between draw segments', () => {
    const layer = createImageLayerStep('a')
    const ai = createAiStep(UPSCALE)
    const flip = createSharpStep('flip')

    const segments = planSegments(
      createPipeline(canvasOfSize(1, 1), [layer, ai, flip]),
    )

    expect(segments).toEqual([
      { kind: 'draw', steps: [layer] },
      { kind: 'ai', step: ai },
      { kind: 'draw', steps: [flip] },
    ])
  })

  it('starts and ends with a draw segment, and keeps two AI steps apart', () => {
    const one = createAiStep(UPSCALE)
    const two = createAiStep(UPSCALE)

    expect(
      planSegments(createPipeline(canvasOfSize(1, 1), [one, two])).map(
        ({ kind }) => kind,
      ),
    ).toEqual(['draw', 'ai', 'draw', 'ai', 'draw'])
  })

  it('drops an AI step that is off, and one in a group that is off', () => {
    const off = { ...createAiStep(UPSCALE), enabled: false }
    const inOff = {
      ...createGroupStep([createAiStep(UPSCALE)]),
      enabled: false,
    }

    expect(
      planSegments(createPipeline(canvasOfSize(1, 1), [off, inOff])).map(
        ({ kind }) => kind,
      ),
    ).toEqual(['draw'])
  })

  it('opens a group that is not a sub-document, and keeps a sub-document whole', () => {
    const ai = createAiStep(UPSCALE)
    const open = createGroupStep([ai])
    const sub = {
      ...createGroupStep([createSharpStep('blur')]),
      subDocument: true,
    }

    const segments = planSegments(
      createPipeline(canvasOfSize(1, 1), [open, sub]),
    )

    expect(segments.map(({ kind }) => kind)).toEqual(['draw', 'ai', 'draw'])
    expect(segments[2]).toEqual({ kind: 'draw', steps: [sub] })
  })
})

describe('workflowProblem', () => {
  const slot = createImageLayerStep()

  it('is undefined for a workflow with an input and a slot', () => {
    expect(workflowProblem(definition([slot]))).toBeUndefined()
  })

  it('asks for an input image', () => {
    expect(workflowProblem(definition([slot], []))).toBe(
      'Add at least one image to run the workflow on.',
    )
  })

  it('asks for a slot when no image layer is waiting for an image', () => {
    expect(workflowProblem(definition([createSharpStep('blur')]))).toBe(
      'Add an image layer with no image: each input image goes in it.',
    )
    expect(workflowProblem(definition([createImageLayerStep('a')]))).toMatch(
      /image layer with no image/,
    )
  })

  it('refuses an AI step inside a sub-document', () => {
    const sub = {
      ...createGroupStep([slot, createAiStep(UPSCALE)]),
      subDocument: true,
    }

    expect(workflowProblem(definition([sub]))).toBe(
      'AI steps inside a sub-document cannot run in a workflow yet.',
    )
  })

  it('ignores an AI step in a sub-document that is off', () => {
    const sub = {
      ...createGroupStep([createAiStep(UPSCALE)]),
      subDocument: true,
      enabled: false,
    }

    expect(workflowProblem(definition([slot, sub]))).toBeUndefined()
  })
})
