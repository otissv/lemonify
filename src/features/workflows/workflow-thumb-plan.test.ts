import { describe, expect, it } from 'vitest'

import { AiToolId } from '@/features/ai/ai-tools'
import { canvasOfSize } from '@/features/pipeline/canvas'
import { createImageLayerStep } from '@/features/pipeline/layer-kinds'
import {
  createAiStep,
  createPipeline,
  createSharpStep,
} from '@/features/pipeline/pipeline'
import { fillFirstSlot, inputSlots } from '@/features/workflows/segments'
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

describe('shownForWorkflowNode', () => {
  const layer = createImageLayerStep()
  const sharpen = createSharpStep('sharpen')
  const ai = createAiStep(UPSCALE)
  const flop = createSharpStep('flop')

  const workflow = {
    ...createWorkflow('Test'),
    pipeline: createPipeline(canvasOfSize(80, 60), [
      layer,
      sharpen,
      ai,
      flop,
    ]),
    inputs: ['src-1'],
  }
  const filled = fillFirstSlot(workflow.pipeline, 'src-1')
  const [slot] = inputSlots(workflow.pipeline)

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