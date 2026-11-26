import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AiToolId } from '@/features/ai/ai-tools'
import { canvasOfSize } from '@/features/pipeline/canvas'
import {
  createDocumentLayerStep,
  createWorkflowLayerStep,
} from '@/features/pipeline/layer-kinds'
import { createAiStep, createPipeline } from '@/features/pipeline/pipeline'
import type { PipelineStep } from '@/features/pipeline/pipeline'
import { CanvasSize, createWorkflow } from '@/features/workflows/workflow'

import { ResultKind } from '../dao/result-dao.ts'
import { JobKind, JobState, isTerminal } from '../jobs/job-types.ts'
import { createTestApp } from '../testing/test-app.ts'
import type { TestApp } from '../testing/test-app.ts'
import type { JobView } from './job-service.ts'

const SETTINGS = { model: 'm', scale: 4, iterations: 1, tta: false } as const
const CANVAS = canvasOfSize(20, 10)

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

async function document(name: string, steps: PipelineStep[] = []) {
  const source = await t.uploadImage(t.ann)
  const created = await t.app.documents.create(t.ann, source.id)
  let view = await t.app.documents.rename(t.ann, created.id, name)
  for (const step of steps) {
    view = await t.app.documents.change(t.ann, created.id, view.revision, {
      type: 'add-step',
      step,
      index: view.pipeline.steps.length,
    })
  }
  return view
}

async function workflow(name: string, steps: PipelineStep[]) {
  const { pipeline, output } = createWorkflow('x', CANVAS)
  return t.app.workflows.create(t.ann, name, {
    pipeline: createPipeline(CANVAS, [...pipeline.steps, ...steps]),
    canvasSize: CanvasSize.Fixed,
    inputs: [],
    output,
  })
}

async function finished(job: JobView): Promise<JobView> {
  await t.app.scheduler.start()
  const limit = Date.now() + 3000
  while (Date.now() < limit) {
    const current = await t.app.jobs.get(t.ann, job.id)
    if (isTerminal(current.state)) return current
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('The job did not finish in time.')
}

async function previewOf(documentId: string) {
  const done = await finished(
    await t.app.renders.requestPreview(t.ann, documentId),
  )
  if (done.result?.kind !== JobKind.Preview) throw new Error('wrong result')
  return done.result
}

describe('an AI step inside a document layer', () => {
  it('waits in the document that holds the layer, and says which layer waits', async () => {
    const ai = upscale()
    const badge = await document('Badge', [ai])
    const layer = createDocumentLayerStep(badge.id)
    const poster = await document('Poster', [layer])

    const preview = await previewOf(poster.id)

    expect(preview.pendingStepIds).toEqual([ai.id])
    expect(preview.waitingLayerIds).toEqual([layer.id])
  })

  it('runs as the used document’s job, keeps its Result there, and tells the holder’s tabs', async () => {
    const ai = upscale()
    const badge = await document('Badge', [ai])
    const poster = await document('Poster', [createDocumentLayerStep(badge.id)])
    t.changes.clear()

    const job = await t.app.renders.requestAiStep(t.ann, poster.id, ai.id)
    const done = await finished(job)

    expect(done.state).toBe(JobState.Done)
    if (done.result?.kind !== JobKind.AiStep) throw new Error('wrong result')
    const stored = await t.app.results.get(t.ann, done.result.resultId)
    expect(stored).toMatchObject({
      kind: ResultKind.AiStep,
      documentId: badge.id,
      stepId: ai.id,
    })
    expect(t.changes.eventsFor(t.ann.userId)).toContainEqual({
      type: 'picture.changed',
      itemId: poster.id,
    })
    expect((await previewOf(poster.id)).pendingStepIds).toEqual([])
    expect((await previewOf(badge.id)).pendingStepIds).toEqual([])
  })
})

describe('an AI step inside a workflow layer', () => {
  it('belongs to the document that holds the layer, which runs and keeps it', async () => {
    const ai = upscale()
    const flow = await workflow('Brand', [ai])
    const source = await t.uploadImage(t.ann)
    const poster = await document('Poster', [
      createWorkflowLayerStep(flow.id, source.id),
    ])

    const done = await finished(
      await t.app.renders.requestAiStep(t.ann, poster.id, ai.id),
    )

    expect(done.state).toBe(JobState.Done)
    if (done.result?.kind !== JobKind.AiStep) throw new Error('wrong result')
    expect(await t.app.results.get(t.ann, done.result.resultId)).toMatchObject({
      documentId: poster.id,
      stepId: ai.id,
    })
    expect((await previewOf(poster.id)).pendingStepIds).toEqual([])
  })

  it('runs once for each image when the same workflow is used twice', async () => {
    const ai = upscale()
    const flow = await workflow('Brand', [ai])
    const one = await t.uploadImage(t.ann, '#111111')
    const two = await t.uploadImage(t.ann, '#222222')
    const poster = await document('Poster', [
      createWorkflowLayerStep(flow.id, one.id),
      createWorkflowLayerStep(flow.id, two.id),
    ])

    expect((await previewOf(poster.id)).pendingStepIds).toEqual([ai.id, ai.id])
    for (let run = 0; run < 2; run += 1) {
      const done = await finished(
        await t.app.renders.requestAiStep(t.ann, poster.id, ai.id),
      )
      expect(done.state).toBe(JobState.Done)
    }
    expect((await previewOf(poster.id)).pendingStepIds).toEqual([])
    expect(t.aiEngine.batches).toHaveLength(2)
  })
})
