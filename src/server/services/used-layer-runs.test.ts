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

import { RunState } from '../dao/workflow-dao.ts'
import { createTestApp } from '../testing/test-app.ts'
import type { TestApp } from '../testing/test-app.ts'
import { EngineTargetKind } from '../tools/image-engine.ts'
import type { RunView } from './workflow-service.ts'

const SETTINGS = { model: 'm', scale: 4, iterations: 1, tta: false } as const
const CANVAS = canvasOfSize(20, 10)
const BADGE_CANVAS = canvasOfSize(8, 6)

let t: TestApp

beforeEach(async () => {
  t = await createTestApp()
})

afterEach(async () => {
  await t.close()
})

function upscale() {
  return createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS })
}

async function workflow(name: string, inputs: string[], steps: PipelineStep[]) {
  const { pipeline, output } = createWorkflow('x', CANVAS)
  return t.app.workflows.create(t.ann, name, {
    pipeline: createPipeline(CANVAS, [...pipeline.steps, ...steps]),
    canvasSize: CanvasSize.Fixed,
    inputs,
    output,
  })
}

async function runFinished(runId: string): Promise<RunView> {
  const limit = Date.now() + 4000
  while (Date.now() < limit) {
    const run = await t.app.workflows.getRun(t.ann, runId)
    if (run.state !== RunState.Running) return run
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('The run did not finish in time.')
}

describe('a run of a workflow whose layers use other items', () => {
  it('runs an AI step inside a used document, on that document’s own picture', async () => {
    const input = await t.uploadImage(t.ann)
    const logo = await t.uploadImage(t.ann, '#0000ff', 'logo.png')
    const badge = await t.app.documents.createFromPipeline(
      t.ann,
      'Badge',
      createPipeline(BADGE_CANVAS, [createImageLayerStep(logo.id), upscale()]),
    )
    const flow = await workflow(
      'Print',
      [input.id],
      [createDocumentLayerStep(badge.id)],
    )

    const run = await t.app.workflows.run(t.ann, flow.id)
    await t.app.scheduler.start()

    expect((await runFinished(run.id)).state).toBe(RunState.Done)
    expect(t.aiEngine.batches).toHaveLength(1)
    const [drawn, finished] = t.imageEngine.requests
    expect(drawn?.target.kind).toBe(EngineTargetKind.Intermediate)
    expect(drawn?.input).toEqual({ kind: 'canvas', canvas: BADGE_CANVAS })
    expect(finished?.target.kind).toBe(EngineTargetKind.Export)
    expect(finished?.steps.at(-1)).toMatchObject({
      kind: 'embedded-document',
      input: { kind: 'file' },
    })
  })

  it('runs AI steps inside a used workflow, and in the run’s own pipeline, in order', async () => {
    const input = await t.uploadImage(t.ann)
    const logo = await t.uploadImage(t.ann, '#0000ff', 'logo.png')
    const inner = await workflow(
      'Brand',
      [],
      [upscale(), createSharpStep('flip')],
    )
    const flow = await workflow(
      'Print',
      [input.id],
      [createWorkflowLayerStep(inner.id, logo.id), upscale()],
    )

    const run = await t.app.workflows.run(t.ann, flow.id)
    await t.app.scheduler.start()

    expect((await runFinished(run.id)).state).toBe(RunState.Done)
    expect(t.aiEngine.batches).toHaveLength(2)
  })

  it('uses the copy the run kept, not what the used document has become', async () => {
    const input = await t.uploadImage(t.ann)
    const badge = await t.app.documents.createFromPipeline(
      t.ann,
      'Badge',
      createPipeline(BADGE_CANVAS, []),
    )
    const flow = await workflow(
      'Print',
      [input.id],
      [createDocumentLayerStep(badge.id)],
    )
    const run = await t.app.workflows.run(t.ann, flow.id)
    const current = await t.app.documents.get(t.ann, badge.id)
    await t.app.documents.change(t.ann, badge.id, current.revision, {
      type: 'add-step',
      step: upscale(),
      index: 0,
    })

    await t.app.scheduler.start()

    expect((await runFinished(run.id)).state).toBe(RunState.Done)
    expect(t.aiEngine.batches).toHaveLength(0)
  })
})
