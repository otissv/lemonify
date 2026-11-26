import { describe, expect, it } from 'vitest'

import { AiToolId } from '@/features/ai/ai-tools'
import { canvasOfSize } from '@/features/pipeline/canvas'
import type { Canvas } from '@/features/pipeline/canvas'
import { DEFAULT_LAYER_SETTINGS } from '@/features/pipeline/layer'
import {
  createDocumentLayerStep,
  createWorkflowLayerStep,
} from '@/features/pipeline/layer-kinds'
import type { UsedItem } from '@/features/pipeline/layer-kinds'
import { createAiStep, createSharpStep } from '@/features/pipeline/pipeline'
import type { PlanStep } from '@/features/pipeline/pipeline'

import { awaitingPlan, planKey, planPipeline } from './plan-pipeline.ts'
import type { PlanLookups } from './plan-pipeline.ts'

const CANVAS = canvasOfSize(10, 10)
const OWN = canvasOfSize(4, 3)
const SOURCE = {
  contentHash: 'a'.repeat(64),
  path: '/data/a',
  width: 4,
  height: 3,
}
const UPSCALE = {
  tool: AiToolId.Upscale,
  settings: { model: 'm', scale: 4, iterations: 1, tta: false },
} as const

type Used = { canvas: Canvas; steps: ReadonlyArray<PlanStep> }

function lookups(used: Record<string, Used | undefined>): PlanLookups {
  return {
    aiResultPath: async () => undefined,
    source: async (id) => (id === 'a' ? SOURCE : undefined),
    used: async (item: UsedItem) =>
      used[item.kind === 'document' ? item.documentId : item.workflowId],
  }
}

function waitingKey(
  plan: { pending: ReadonlyArray<{ step: { id: string }; key: string }> },
  stepId: string,
): string {
  return plan.pending.find(({ step }) => step.id === stepId)?.key ?? ''
}

describe('planning a document layer', () => {
  it('draws the document as it is now, on its own canvas, placed like a layer', async () => {
    const flip = createSharpStep('flip')
    const layer = { ...createDocumentLayerStep('doc-b'), opacity: 30 }

    const plan = await planPipeline(
      CANVAS,
      [layer],
      lookups({ 'doc-b': { canvas: OWN, steps: [flip] } }),
    )

    expect(plan.skipped).toEqual([])
    expect(plan.applied).toEqual([layer])
    expect(plan.steps).toEqual([
      {
        kind: 'embedded-document',
        input: { kind: 'canvas', canvas: OWN },
        steps: [flip],
        ...DEFAULT_LAYER_SETTINGS,
        opacity: 30,
      },
    ])
    expect(plan.subPlans.get(layer.id)?.baseKey).toContain('4x3')
  })

  it('makes another picture when the used document changes', async () => {
    const layer = createDocumentLayerStep('doc-b')
    const before = await planPipeline(
      CANVAS,
      [layer],
      lookups({ 'doc-b': { canvas: OWN, steps: [createSharpStep('flip')] } }),
    )
    const after = await planPipeline(
      CANVAS,
      [layer],
      lookups({ 'doc-b': { canvas: OWN, steps: [createSharpStep('flop')] } }),
    )
    expect(planKey(before)).not.toBe(planKey(after))
  })

  it('says so when the document is gone, and leaves the layer out', async () => {
    const layer = createDocumentLayerStep('doc-gone')

    const plan = await planPipeline(CANVAS, [layer], lookups({}))

    expect(plan.applied).toEqual([])
    expect(plan.skipped).toEqual([
      { stepId: layer.id, message: 'That document is no longer available.' },
    ])
  })

  it('waits for an AI step inside it, which the used document runs and keeps', async () => {
    const ai = createAiStep(UPSCALE)
    const layer = createDocumentLayerStep('doc-b')

    const plan = await planPipeline(
      CANVAS,
      [layer],
      lookups({ 'doc-b': { canvas: OWN, steps: [ai] } }),
    )

    expect(plan.pending).toEqual([
      { step: ai, key: expect.any(String), documentId: 'doc-b' },
    ])
    expect(awaitingPlan(plan, waitingKey(plan, ai.id))?.baseKey).toContain(
      '4x3',
    )
  })
})

describe('who owns an AI step', () => {
  it('names the used document, at any depth, and no one for steps the holder owns', async () => {
    const own = createAiStep(UPSCALE)
    const inB = createAiStep(UPSCALE)
    const inC = createAiStep(UPSCALE)
    const inFlow = createAiStep(UPSCALE)

    const plan = await planPipeline(
      CANVAS,
      [
        own,
        createDocumentLayerStep('doc-b'),
        createWorkflowLayerStep('flow-1'),
      ],
      lookups({
        'doc-b': {
          canvas: OWN,
          steps: [inB, createDocumentLayerStep('doc-c')],
        },
        'doc-c': { canvas: OWN, steps: [inC] },
        'flow-1': { canvas: OWN, steps: [inFlow] },
      }),
    )

    expect(plan.aiOwners).toEqual(
      new Map([
        [inB.id, 'doc-b'],
        [inC.id, 'doc-c'],
      ]),
    )
    expect([...plan.aiKeys.keys()]).toEqual(
      expect.arrayContaining([own.id, inB.id, inC.id, inFlow.id]),
    )
  })
})

describe('planning a workflow layer', () => {
  it('draws the workflow on its own picture, and runs its AI steps for the document that holds it', async () => {
    const ai = createAiStep(UPSCALE)
    const layer = createWorkflowLayerStep('flow-1', 'a')

    const plan = await planPipeline(
      CANVAS,
      [layer],
      lookups({ 'flow-1': { canvas: OWN, steps: [ai] } }),
    )

    expect(plan.pending).toEqual([{ step: ai, key: expect.any(String) }])
  })

  it('says so when the workflow or its image is gone', async () => {
    const noFlow = createWorkflowLayerStep('flow-gone')
    const noImage = createWorkflowLayerStep('flow-1', 'gone')

    const plan = await planPipeline(
      CANVAS,
      [noFlow, noImage],
      lookups({ 'flow-1': { canvas: OWN, steps: [] } }),
    )

    expect(plan.skipped).toEqual([
      { stepId: noFlow.id, message: 'That workflow is no longer available.' },
      { stepId: noImage.id, message: 'This image is no longer available.' },
    ])
  })
})

describe('layers that use other items, nested', () => {
  it('refuses to go deeper than 8 levels', async () => {
    const used: Record<string, Used> = {}
    for (let level = 0; level < 12; level += 1) {
      used[`doc-${level}`] = {
        canvas: OWN,
        steps: [createDocumentLayerStep(`doc-${level + 1}`)],
      }
    }

    const plan = await planPipeline(
      CANVAS,
      [createDocumentLayerStep('doc-0')],
      lookups(used),
    )

    expect(plan.skipped.map(({ message }) => message)).toContain(
      'Layers that use other documents and workflows go at most 8 deep.',
    )
  })
})
