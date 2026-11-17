import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AiToolId } from '@/features/ai/ai-tools'
import { ExportFormat } from '@/features/export/export-settings'
import {
  createAiStep,
  createLayerStep,
  createSharpStep,
} from '@/features/pipeline/pipeline'
import type { AiStep, PipelineStep } from '@/features/pipeline/pipeline'

import { ResultKind } from '../dao/result-dao.ts'
import {
  ConflictError,
  LimitError,
  NotFoundError,
  ValidationError,
} from '../errors.ts'
import { JobKind, JobState, isTerminal } from '../jobs/job-types.ts'
import { EngineTargetKind } from '../tools/image-engine.ts'
import { RenderKind } from '../tools/render-store.ts'
import { createTestApp } from '../testing/test-app.ts'
import type { TestApp } from '../testing/test-app.ts'
import type { JobView } from './job-service.ts'

/** The fake AI engine writes `ai:` and the Job id (a UUID), so a User with this limit has room for exactly one. */
const FAKE_AI_RESULT_BYTES = 3 + 36
const SETTINGS = { model: 'm', scale: 4, iterations: 1, tta: false } as const

let t: TestApp

beforeEach(async () => {
  t = await createTestApp()
})

afterEach(async () => {
  await t.close()
})

async function newDocument(actor = t.ann, colour?: string) {
  const source = await t.uploadImage(actor, colour)
  return t.app.documents.create(actor, source.id)
}

async function addStep(documentId: string, step: PipelineStep, actor = t.ann) {
  const view = await t.app.documents.get(actor, documentId)
  return t.app.documents.change(actor, documentId, view.revision, {
    type: 'add-step',
    step,
    index: view.pipeline.steps.length,
  })
}

async function finished(job: JobView, actor = t.ann): Promise<JobView> {
  const limit = Date.now() + 3000
  while (Date.now() < limit) {
    const current = await t.app.jobs.get(actor, job.id)
    if (isTerminal(current.state)) return current
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('The job did not finish in time.')
}

async function run(job: JobView, actor = t.ann): Promise<JobView> {
  await t.app.scheduler.start()
  return finished(job, actor)
}

describe('previews', () => {
  it('queues, renders and caches a preview of the Pipeline', async () => {
    const document = await newDocument()
    const blurred = await addStep(
      document.id,
      createSharpStep('blur', { sigma: 2 }),
    )
    const job = await t.app.renders.requestPreview(t.ann, document.id)
    expect(job).toMatchObject({
      kind: JobKind.Preview,
      state: JobState.Waiting,
    })

    const done = await run(job)
    expect(done.state).toBe(JobState.Done)
    if (done.result?.kind !== JobKind.Preview) throw new Error('wrong result')
    expect(done.result.pendingStepIds).toEqual([])
    const request = t.imageEngine.requests[0]
    expect(request?.target.kind).toBe(EngineTargetKind.Preview)
    expect(
      request?.steps.map((step) =>
        step.kind === 'sharp' ? step.op : step.kind,
      ),
    ).toEqual(['blur'])

    const opened = await t.app.renders.fetch(
      t.ann,
      document.id,
      RenderKind.Preview,
      done.result.key,
    )
    expect(opened.mediaType).toBe('image/webp')
    expect(blurred.revision).toBe(1)
  })

  it('reuses a cached render instead of rendering again', async () => {
    const document = await newDocument()
    await addStep(document.id, createSharpStep('flip'))
    const first = await run(
      await t.app.renders.requestPreview(t.ann, document.id),
    )
    const second = await finished(
      await t.app.renders.requestPreview(t.ann, document.id),
    )
    expect(second.state).toBe(JobState.Done)
    expect(t.imageEngine.requests).toHaveLength(1)
    expect(first.result).toEqual(second.result)
  })

  it('returns the queued Job when the same revision is asked for twice', async () => {
    const document = await newDocument()
    const a = await t.app.renders.requestPreview(t.ann, document.id)
    const b = await t.app.renders.requestPreview(t.ann, document.id)
    expect(b.id).toBe(a.id)
  })

  it('drops an older queued preview when the Document has moved on (latest wins)', async () => {
    const document = await newDocument()
    const older = await t.app.renders.requestPreview(t.ann, document.id)
    await addStep(document.id, createSharpStep('flip'))
    const newer = await t.app.renders.requestPreview(t.ann, document.id)
    expect(newer.id).not.toBe(older.id)
    expect((await t.app.jobs.get(t.ann, older.id)).state).toBe(
      JobState.Cancelled,
    )
    expect((await run(newer)).state).toBe(JobState.Done)
  })

  it('cancels a preview whose Document changed before it started', async () => {
    const document = await newDocument()
    const job = await t.app.renders.requestPreview(t.ann, document.id)
    await addStep(document.id, createSharpStep('flip'))
    expect((await run(job)).state).toBe(JobState.Cancelled)
    expect(t.imageEngine.requests).toHaveLength(0)
  })

  it('shows the Pipeline only up to an AI step that has not run', async () => {
    const document = await newDocument()
    await addStep(document.id, createSharpStep('flip'))
    const ai = createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS })
    await addStep(document.id, ai)
    await addStep(document.id, createSharpStep('flop'))
    const done = await run(
      await t.app.renders.requestPreview(t.ann, document.id),
    )
    if (done.result?.kind !== JobKind.Preview) throw new Error('wrong result')
    expect(done.result.pendingStepIds).toEqual([ai.id])
    expect(
      t.imageEngine.requests[0]?.steps.map((step) =>
        step.kind === 'sharp' ? step.op : step.kind,
      ),
    ).toEqual(['flip'])
  })

  it('reports a step that is not set up and still renders the rest', async () => {
    const document = await newDocument()
    const incomplete = createSharpStep('extract')
    await addStep(document.id, incomplete)
    await addStep(document.id, createSharpStep('flip'))
    const done = await run(
      await t.app.renders.requestPreview(t.ann, document.id),
    )
    if (done.result?.kind !== JobKind.Preview) throw new Error('wrong result')
    expect(done.result.problems.map(({ stepId }) => stepId)).toEqual([
      incomplete.id,
    ])
    expect(
      t.imageEngine.requests[0]?.steps.map((step) =>
        step.kind === 'sharp' ? step.op : step.kind,
      ),
    ).toEqual(['flip'])
  })

  it('fails a preview in plain words when the engine breaks, and logs the detail', async () => {
    const document = await newDocument()
    t.imageEngine.failWith = new Error('boom /secret/path')
    const done = await run(
      await t.app.renders.requestPreview(t.ann, document.id),
    )
    expect(done.state).toBe(JobState.Failed)
    expect(done.error).toBe('The job failed unexpectedly.')
    expect(JSON.stringify(t.logger.lines)).toContain('boom')
  })
})

describe('thumbnails', () => {
  it('makes a picture after each step, and none for a switched-off step', async () => {
    const document = await newDocument()
    const first = createSharpStep('flip')
    const second = { ...createSharpStep('flop'), enabled: false }
    await addStep(document.id, first)
    await addStep(document.id, second)
    const done = await run(
      await t.app.renders.requestThumbnails(t.ann, document.id),
    )
    if (done.result?.kind !== JobKind.Thumbnail) throw new Error('wrong result')
    const [open, one, two] = done.result.thumbnails
    expect(open?.key).toMatch(/^[0-9a-f]{64}$/)
    expect(one?.stepId).toBe(first.id)
    expect(one?.key).toMatch(/^[0-9a-f]{64}$/)
    expect(two).toEqual({ stepId: second.id, key: null })
    expect(
      (
        await t.app.renders.fetch(
          t.ann,
          document.id,
          RenderKind.Thumbnail,
          one?.key ?? '',
        )
      ).mediaType,
    ).toBe('image/webp')
  })
})

describe('AI steps', () => {
  it('runs an AI step, keeps its output as a Result and uses it for the next preview', async () => {
    const document = await newDocument()
    await addStep(document.id, createSharpStep('flip'))
    const ai = createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS })
    await addStep(document.id, ai)
    await addStep(document.id, createSharpStep('flop'))

    const done = await run(
      await t.app.renders.requestAiStep(t.ann, document.id, ai.id),
    )
    expect(done.state).toBe(JobState.Done)
    if (done.result?.kind !== JobKind.AiStep) throw new Error('wrong result')
    const stored = await t.app.results.get(t.ann, done.result.resultId)
    expect(stored).toMatchObject({
      kind: ResultKind.AiStep,
      documentId: document.id,
      stepId: ai.id,
      mediaType: 'image/png',
    })
    expect(t.aiEngine.batches).toHaveLength(1)
    expect(t.aiEngine.batches[0]?.settings).toEqual(SETTINGS)
    // the Sharp step before the AI step was applied first
    expect(t.imageEngine.requests[0]?.target.kind).toBe(
      EngineTargetKind.Intermediate,
    )

    const preview = await finished(
      await t.app.renders.requestPreview(t.ann, document.id),
    )
    if (preview.result?.kind !== JobKind.Preview)
      throw new Error('wrong result')
    expect(preview.result.pendingStepIds).toEqual([])
    const request = t.imageEngine.requests.at(-1)
    expect(request?.input).toContain('results')
    expect(
      request?.steps.map((step) =>
        step.kind === 'sharp' ? step.op : step.kind,
      ),
    ).toEqual(['flop'])
  })

  it('refuses a step that is not an enabled AI step', async () => {
    const document = await newDocument()
    const blur = createSharpStep('blur', { sigma: 1 })
    await addStep(document.id, blur)
    await expect(
      t.app.renders.requestAiStep(t.ann, document.id, blur.id),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      t.app.renders.requestAiStep(t.ann, document.id, 'missing'),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('makes the earlier AI step run first', async () => {
    const document = await newDocument()
    const first = createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS })
    const second = createAiStep({
      tool: AiToolId.Upscale,
      settings: { ...SETTINGS, scale: 2 },
    })
    await addStep(document.id, first)
    await addStep(document.id, second)
    await expect(
      t.app.renders.requestAiStep(t.ann, document.id, second.id),
    ).rejects.toThrow('Run the earlier AI steps first.')
  })

  it('refuses to run a step again once it has a Result', async () => {
    const document = await newDocument()
    const ai = createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS })
    await addStep(document.id, ai)
    await run(await t.app.renders.requestAiStep(t.ann, document.id, ai.id))
    await expect(
      t.app.renders.requestAiStep(t.ann, document.id, ai.id),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('returns the queued Job when the step is asked for twice', async () => {
    const document = await newDocument()
    const ai = createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS })
    await addStep(document.id, ai)
    const a = await t.app.renders.requestAiStep(t.ann, document.id, ai.id)
    const b = await t.app.renders.requestAiStep(t.ann, document.id, ai.id)
    expect(b.id).toBe(a.id)
  })

  it('fails the Job, with the engine’s message, when the model fails', async () => {
    const document = await newDocument()
    const ai = createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS })
    await addStep(document.id, ai)
    t.aiEngine.failWith = new Error('The GPU ran out of memory')
    const done = await run(
      await t.app.renders.requestAiStep(t.ann, document.id, ai.id),
    )
    expect(done.state).toBe(JobState.Failed)
    expect(done.error).toBe('The GPU ran out of memory')
    expect(await t.app.results.list(t.ann)).toEqual([])
  })

  it('runs waiting steps that share a model as one batch', async () => {
    const docs = await Promise.all([
      newDocument(t.ann, '#111111'),
      newDocument(t.ann, '#222222'),
    ])
    const steps: AiStep[] = []
    for (const document of docs) {
      const ai = createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS })
      steps.push(ai)
      await addStep(document.id, ai)
    }
    let release: () => void = () => {}
    t.aiEngine.gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const jobs: JobView[] = []
    for (const [index, document] of docs.entries()) {
      jobs.push(
        await t.app.renders.requestAiStep(
          t.ann,
          document.id,
          steps[index]?.id ?? '',
        ),
      )
    }
    release()
    for (const job of jobs) expect((await run(job)).state).toBe(JobState.Done)
    expect(t.aiEngine.batches).toHaveLength(1)
    expect(t.aiEngine.batches[0]?.requests).toHaveLength(2)
  })

  it('refuses when the User has used up their Result storage', async () => {
    await t.close()
    t = await createTestApp({
      LEMONIFY_MAX_RESULT_BYTES_PER_USER: String(FAKE_AI_RESULT_BYTES),
    })
    const document = await newDocument()
    const ai = createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS })
    await addStep(document.id, ai)
    const first = await run(
      await t.app.renders.requestAiStep(t.ann, document.id, ai.id),
    )
    expect(first.state).toBe(JobState.Done)
    const next = createAiStep({
      tool: AiToolId.Upscale,
      settings: { ...SETTINGS, scale: 2 },
    })
    await addStep(document.id, next)
    await expect(
      t.app.renders.requestAiStep(t.ann, document.id, next.id),
    ).rejects.toBeInstanceOf(LimitError)
  })

  it('clears the Results the current Pipeline no longer uses and keeps the rest', async () => {
    const document = await newDocument()
    const ai = createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS })
    await addStep(document.id, ai)
    await run(await t.app.renders.requestAiStep(t.ann, document.id, ai.id))
    const view = await t.app.documents.get(t.ann, document.id)
    await t.app.documents.change(t.ann, document.id, view.revision, {
      type: 'set-settings',
      stepId: ai.id,
      tool: AiToolId.Upscale,
      settings: { ...SETTINGS, scale: 2 },
    })
    await finished(await t.app.renders.requestAiStep(t.ann, document.id, ai.id))
    expect(await t.app.results.list(t.ann)).toHaveLength(2)

    expect(await t.app.renders.clearUnusedResults(t.ann, document.id)).toEqual({
      removed: 1,
    })
    const left = await t.app.results.list(t.ann)
    expect(left).toHaveLength(1)
    expect(left[0]?.stepId).toBe(ai.id)
  })
})

describe('exports', () => {
  const JPEG = {
    format: ExportFormat.Jpeg,
    options: { quality: 70 },
    keepMetadata: false,
  }

  it('exports the whole Pipeline as a Result the User can download', async () => {
    const document = await newDocument()
    await addStep(document.id, createSharpStep('flip'))
    const done = await run(
      await t.app.renders.requestExport(t.ann, document.id, JPEG, 300),
    )
    expect(done.state).toBe(JobState.Done)
    if (done.result?.kind !== JobKind.Export) throw new Error('wrong result')
    const stored = await t.app.results.get(t.ann, done.result.resultId)
    expect(stored).toMatchObject({
      kind: ResultKind.Export,
      documentId: document.id,
    })
    expect(stored.fileName).toBe('cat.webp')
    const request = t.imageEngine.requests[0]
    expect(request?.target).toMatchObject({
      kind: EngineTargetKind.Export,
      width: 300,
    })
    const opened = await t.app.results.open(t.ann, stored.id)
    expect(opened.fileName).toBe('cat.webp')
  })

  it('refuses before queueing when the options are not valid for the format', async () => {
    const document = await newDocument()
    await expect(
      t.app.renders.requestExport(t.ann, document.id, {
        ...JPEG,
        options: { quality: 500 },
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('refuses while an AI step has not run, or a step is not set up', async () => {
    const document = await newDocument()
    await addStep(
      document.id,
      createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS }),
    )
    await expect(
      t.app.renders.requestExport(t.ann, document.id, JPEG),
    ).rejects.toThrow('Run the AI steps before exporting.')
    const other = await newDocument(t.ann, '#abcdef')
    await addStep(other.id, createSharpStep('extract'))
    await expect(
      t.app.renders.requestExport(t.ann, other.id, JPEG),
    ).rejects.toThrow(/Needs/)
  })
})

describe('the document’s image and layers', () => {
  it('previews the image the document’s image was replaced with', async () => {
    const first = await t.uploadImage(t.ann, '#ff0000')
    const second = await t.uploadImage(t.ann, '#0000ff')
    const document = await t.app.documents.create(t.ann, first.id)
    const [open] = document.pipeline.steps
    if (open === undefined) throw new Error('no step')
    await t.app.documents.change(t.ann, document.id, document.revision, {
      type: 'set-source',
      stepId: open.id,
      sourceId: second.id,
    })

    const done = await run(
      await t.app.renders.requestPreview(t.ann, document.id),
    )

    expect(done.state).toBe(JobState.Done)
  })

  it('sends a layer to the engine in its place among the steps, with its image as a file', async () => {
    const document = await newDocument()
    const top = await t.uploadImage(t.ann, '#00ff00', 'top.png')
    const layer = {
      ...createLayerStep(top.id),
      opacity: 40,
      blend: 'multiply' as const,
    }
    await addStep(document.id, createSharpStep('blur', { sigma: 2 }))
    await addStep(document.id, layer)

    const done = await run(
      await t.app.renders.requestPreview(t.ann, document.id),
    )

    expect(done.state).toBe(JobState.Done)
    const steps = t.imageEngine.requests[0]?.steps
    expect(
      steps?.map((step) => (step.kind === 'sharp' ? step.op : step.kind)),
    ).toEqual(['blur', 'layer'])
    expect(steps?.[1]).toMatchObject({
      kind: 'layer',
      opacity: 40,
      blend: 'multiply',
      path: await t.app.sources.pathOf(t.ann, top.id),
    })
  })

  it('thumbnails a layer as its own image', async () => {
    const document = await newDocument()
    const top = await t.uploadImage(t.ann, '#00ff00', 'top.png')
    const layer = createLayerStep(top.id)
    await addStep(document.id, layer)

    const job = await t.app.renders.requestThumbnails(t.ann, document.id)
    const done = await run(job)

    if (done.result?.kind !== JobKind.Thumbnail) throw new Error('wrong result')
    const thumbnail = done.result.thumbnails.find(
      ({ stepId }) => stepId === layer.id,
    )
    expect(thumbnail?.key).not.toBeNull()
    const request = t.imageEngine.requests.at(-1)
    expect(request?.steps).toEqual([])
    expect(request?.input).toBe(await t.app.sources.pathOf(t.ann, top.id))
  })
})

describe('ownership', () => {
  it('treats another User’s Document as missing for every request', async () => {
    const document = await newDocument(t.ann)
    const ai = createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS })
    await addStep(document.id, ai)
    const requests = [
      t.app.renders.requestPreview(t.bob, document.id),
      t.app.renders.requestThumbnails(t.bob, document.id),
      t.app.renders.requestAiStep(t.bob, document.id, ai.id),
      t.app.renders.requestExport(t.bob, document.id, {
        format: ExportFormat.Png,
        options: {},
        keepMetadata: false,
      }),
      t.app.renders.fetch(
        t.bob,
        document.id,
        RenderKind.Preview,
        'a'.repeat(64),
      ),
      t.app.renders.clearUnusedResults(t.bob, document.id),
    ]
    for (const request of requests) {
      await expect(request).rejects.toBeInstanceOf(NotFoundError)
    }
  })

  it('never shows one User’s Job or Result to another', async () => {
    const document = await newDocument(t.ann)
    const job = await run(
      await t.app.renders.requestPreview(t.ann, document.id),
    )
    await expect(t.app.jobs.get(t.bob, job.id)).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })
})

describe('fetch', () => {
  it('does not find a render that was never made, or a key that is not a hash', async () => {
    const document = await newDocument()
    await expect(
      t.app.renders.fetch(
        t.ann,
        document.id,
        RenderKind.Preview,
        'b'.repeat(64),
      ),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      t.app.renders.fetch(
        t.ann,
        document.id,
        RenderKind.Preview,
        '../etc/passwd',
      ),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
