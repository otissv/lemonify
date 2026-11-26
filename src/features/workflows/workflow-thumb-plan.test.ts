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
import { fillInputSlot, inputSlot } from '@/features/workflows/segments'
import { createWorkflow } from '@/features/workflows/workflow'
import {
  CANVAS_NODE_ID,
  INPUTS_NODE_ID,
  OUTPUT_NODE_ID,
} from '@/features/workflows/workflow-graph-layout'
import {
  omitAiSteps,
  shownForWorkflowNode,
} from '@/features/workflows/workflow-thumb-plan'

const UPSCALE = {
  tool: AiToolId.Upscale,
  settings: { model: 'm', scale: 4, iterations: 1, tta: false },
} as const

describe('omitAiSteps', () => {
  it('drops enabled AI steps but keeps Sharp steps after them', () => {
    const layer = createImageLayerStep()
    const ai = createAiStep(UPSCALE)
    const blur = createSharpStep('blur')
    const steps = omitAiSteps([layer, ai, blur])
    expect(steps.map(({ id }) => id)).toEqual([layer.id, blur.id])
  })
})

describe('omitAiSteps in embedded document layers', () => {
  it('drops AI steps at any depth inside them', () => {
    const blur = createSharpStep('blur')
    const embedded = createEmbeddedDocumentStep([
      createGroupStep([createAiStep(UPSCALE), blur]),
      createEmbeddedDocumentStep([createAiStep(UPSCALE)]),
    ])

    const [kept] = omitAiSteps([embedded])

    expect(kept).toMatchObject({
      steps: [{ steps: [blur] }, { steps: [] }],
    })
  })
})

describe('shownForWorkflowNode with nesting', () => {
  const slot = createImageLayerStep()
  const blur = createSharpStep('blur')
  const flip = createSharpStep('flip')
  const group = createGroupStep([flip])
  const embedded = createEmbeddedDocumentStep([blur, group])
  const pipeline = createPipeline(canvasOfSize(80, 60), [slot, embedded])

  it('shows a step inside an embedded document layer on that layer’s own picture', () => {
    const shown = shownForWorkflowNode(pipeline, flip.id, slot.id)
    expect(shown?.steps.map(({ id }) => id)).toEqual([blur.id, flip.id])
  })

  it('shows the picture an embedded document layer leaves, and none for a group', () => {
    const shown = shownForWorkflowNode(pipeline, embedded.id, slot.id)
    expect(shown?.steps.map(({ id }) => id)).toEqual([slot.id, embedded.id])
    expect(shownForWorkflowNode(pipeline, group.id, slot.id)).toBeUndefined()
  })
})

describe('shownForWorkflowNode', () => {
  const layer = createImageLayerStep()
  const sharpen = createSharpStep('sharpen')
  const ai = createAiStep(UPSCALE)
  const flop = createSharpStep('flop')

  const workflow = {
    ...createWorkflow('Test'),
    pipeline: createPipeline(canvasOfSize(80, 60), [layer, sharpen, ai, flop]),
    inputs: ['src-1'],
  }
  const filled = fillInputSlot(workflow.pipeline, 'src-1')
  const slot = inputSlot(workflow.pipeline)

  it('shows only the canvas for the canvas node', () => {
    expect(
      shownForWorkflowNode(filled, CANVAS_NODE_ID, slot?.id)?.steps,
    ).toEqual([])
  })

  it('shows through the input layer on the inputs node', () => {
    const shown = shownForWorkflowNode(filled, INPUTS_NODE_ID, slot?.id)
    expect(shown?.steps.map(({ id }) => id)).toEqual([layer.id])
  })

  it('skips AI on the upscale node and keeps the picture before it', () => {
    const shown = shownForWorkflowNode(filled, ai.id, slot?.id)
    expect(shown?.steps.map(({ id }) => id)).toEqual([layer.id, sharpen.id])
  })

  it('still skips AI on a Sharp step after it', () => {
    const shown = shownForWorkflowNode(filled, flop.id, slot?.id)
    expect(shown?.steps.map(({ id }) => id)).toEqual([
      layer.id,
      sharpen.id,
      flop.id,
    ])
  })

  it('includes every non-AI step on the output node', () => {
    const shown = shownForWorkflowNode(filled, OUTPUT_NODE_ID, slot?.id)
    expect(shown?.steps.map(({ id }) => id)).toEqual([
      layer.id,
      sharpen.id,
      flop.id,
    ])
  })
})
