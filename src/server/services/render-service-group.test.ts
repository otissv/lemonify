import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AiToolId } from '@/features/ai/ai-tools'
import { ExportFormat } from '@/features/export/export-settings'
import {
  createAiStep,
  createGroupStep,
  createSharpStep,
} from '@/features/pipeline/pipeline'
import { createImageLayerStep } from '@/features/pipeline/layer-kinds'
import type { LeafStep } from '@/features/pipeline/pipeline'

import { ValidationError } from '../errors.ts'
import { JobKind, JobState, isTerminal } from '../jobs/job-types.ts'
import { createTestApp } from '../testing/test-app.ts'
import type { TestApp } from '../testing/test-app.ts'
import type { JobView } from './job-service.ts'

const SETTINGS = { model: 'm', scale: 4, iterations: 1, tta: false } as const

let t: TestApp

beforeEach(async () => {
  t = await createTestApp()
})

afterEach(async () => {
  await t.close()
})

async function newDocument(colour = '#336699') {
  const source = await t.uploadImage(t.ann, colour)
  return t.app.documents.create(t.ann, source.id)
}

async function addAll(documentId: string, steps: ReadonlyArray<LeafStep>) {
  for (const step of steps) {
    const view = await t.app.documents.get(t.ann, documentId)
    await t.app.documents.change(t.ann, documentId, view.revision, {
      type: 'add-step',
      step,
      index: view.pipeline.steps.length,
    })
  }
}

/** Wraps the steps after the first layer in a group. */
async function groupAll(
  documentId: string,
  members: ReadonlyArray<LeafStep>,
  enabled = true,
) {
  const view = await t.app.documents.get(t.ann, documentId)
  const group = { ...createGroupStep(members), enabled }
  await t.app.documents.change(t.ann, documentId, view.revision, {
    type: 'group-steps',
    group,
  })
  return group
}

async function finished(job: JobView): Promise<JobView> {
  const limit = Date.now() + 3000
  while (Date.now() < limit) {
    const current = await t.app.jobs.get(t.ann, job.id)
    if (isTerminal(current.state)) return current
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('The job did not finish in time.')
}

async function run(job: JobView): Promise<JobView> {
  await t.app.scheduler.start()
  return finished(job)
}

async function previewKey(documentId: string): Promise<string> {
  const done = await run(await t.app.renders.requestPreview(t.ann, documentId))
  if (done.result?.kind !== JobKind.Preview) throw new Error('wrong result')
  return done.result.key
}

describe('previews of a document with groups', () => {
  it('makes the same picture whether or not the steps are grouped', async () => {
    const blur = createSharpStep('blur', { sigma: 2 })
    const flop = createSharpStep('flop')
    const flat = await newDocument()
    await addAll(flat.id, [blur, flop])
    const grouped = await newDocument()
    const members = [
      { ...blur, id: crypto.randomUUID() },
      { ...flop, id: crypto.randomUUID() },
    ]
    await addAll(grouped.id, members)
    await groupAll(grouped.id, members)

    const groupedKey = await previewKey(grouped.id)
    expect(await previewKey(flat.id)).toBe(groupedKey)
    expect(t.imageEngine.requests).toHaveLength(1)
  })

  it('leaves out the steps of a group that is switched off', async () => {
    const bare = await newDocument()
    const grouped = await newDocument()
    const members = [createSharpStep('blur', { sigma: 2 })]
    await addAll(grouped.id, members)
    await groupAll(grouped.id, members, false)

    expect(await previewKey(grouped.id)).toBe(await previewKey(bare.id))
  })

  it('keeps a step’s own switch inside a group that is on', async () => {
    const off = { ...createSharpStep('blur', { sigma: 2 }), enabled: false }
    const grouped = await newDocument()
    await addAll(grouped.id, [off])
    await groupAll(grouped.id, [off])
    const bare = await newDocument()

    expect(await previewKey(grouped.id)).toBe(await previewKey(bare.id))
  })
})

describe('AI steps in groups', () => {
  it('runs an AI step inside a group, and the next preview uses its result', async () => {
    const document = await newDocument()
    const ai = createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS })
    await addAll(document.id, [ai])
    await groupAll(document.id, [ai])

    const done = await run(
      await t.app.renders.requestAiStep(t.ann, document.id, ai.id),
    )

    expect(done.state).toBe(JobState.Done)
    const preview = await run(
      await t.app.renders.requestPreview(t.ann, document.id),
    )
    if (preview.result?.kind !== JobKind.Preview)
      throw new Error('wrong result')
    expect(preview.result.pendingStepIds).toEqual([])
  })

  it('says an AI step is waiting when it is inside a group that is on', async () => {
    const document = await newDocument()
    const ai = createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS })
    await addAll(document.id, [ai])
    await groupAll(document.id, [ai])

    const preview = await run(
      await t.app.renders.requestPreview(t.ann, document.id),
    )

    if (preview.result?.kind !== JobKind.Preview)
      throw new Error('wrong result')
    expect(preview.result.pendingStepIds).toEqual([ai.id])
  })

  it('does not run an AI step inside a group that is switched off', async () => {
    const document = await newDocument()
    const ai = createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS })
    await addAll(document.id, [ai])
    await groupAll(document.id, [ai], false)

    await expect(
      t.app.renders.requestAiStep(t.ann, document.id, ai.id),
    ).rejects.toBeInstanceOf(ValidationError)
    const preview = await run(
      await t.app.renders.requestPreview(t.ann, document.id),
    )
    if (preview.result?.kind !== JobKind.Preview)
      throw new Error('wrong result')
    expect(preview.result.pendingStepIds).toEqual([])
  })

  it('refuses an export while an AI step in a group has no result', async () => {
    const document = await newDocument()
    const ai = createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS })
    await addAll(document.id, [ai])
    await groupAll(document.id, [ai])

    await expect(
      t.app.renders.requestExport(t.ann, document.id, {
        format: ExportFormat.Png,
        options: {},
        keepMetadata: false,
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('thumbnails of a document with groups', () => {
  it('makes one for each step inside a group, and none for the group itself', async () => {
    const document = await newDocument()
    const flip = createSharpStep('flip')
    await addAll(document.id, [flip])
    const group = await groupAll(document.id, [flip])

    const all = await run(
      await t.app.renders.requestThumbnails(t.ann, document.id),
    )
    const asked = await run(
      await t.app.renders.requestThumbnails(t.ann, document.id, [group.id]),
    )

    if (all.result?.kind !== JobKind.Thumbnail) throw new Error('wrong result')
    if (asked.result?.kind !== JobKind.Thumbnail)
      throw new Error('wrong result')
    const listed = all.result.thumbnails.map(({ stepId }) => stepId)
    expect(listed).toContain(flip.id)
    expect(listed).not.toContain(group.id)
    expect(
      all.result.thumbnails.find(({ stepId }) => stepId === flip.id)?.key,
    ).toMatch(/^[0-9a-f]{64}$/)
    expect(asked.result.thumbnails).toEqual([{ stepId: group.id, key: null }])
  })
})

async function subDocument(
  documentId: string,
  members: ReadonlyArray<LeafStep>,
  enabled = true,
) {
  await addAll(documentId, members)
  const group = {
    ...createGroupStep(members, 'Logo'),
    subDocument: true,
    enabled,
  }
  const view = await t.app.documents.get(t.ann, documentId)
  await t.app.documents.change(t.ann, documentId, view.revision, {
    type: 'group-steps',
    group,
  })
  return group
}

async function previewOf(documentId: string) {
  const done = await run(await t.app.renders.requestPreview(t.ann, documentId))
  if (done.result?.kind !== JobKind.Preview) throw new Error('wrong result')
  return done.result
}

describe('sub-documents', () => {
  it('are drawn on the canvas as a picture of their own', async () => {
    const logo = await t.uploadImage(t.ann, '#cc0000', 'logo.png')
    const document = await newDocument()
    const flip = createSharpStep('flip')
    await subDocument(document.id, [createImageLayerStep(logo.id), flip])

    await previewOf(document.id)

    const [request] = t.imageEngine.requests
    expect(request?.steps.at(-1)).toMatchObject({
      kind: 'sub-document',
      input: { kind: 'canvas', canvas: { width: 8, height: 6 } },
      steps: [{ kind: 'layer' }, { op: 'flip' }],
    })
  })

  it('are still drawn when none of their layers is on, as a picture with nothing in it', async () => {
    const document = await newDocument()
    const bare = await newDocument()
    await subDocument(document.id, [createSharpStep('flip')])

    const result = await previewOf(document.id)

    expect(result.problems).toEqual([])
    expect(result.key).not.toBe((await previewOf(bare.id)).key)
  })

  it('can be exported without a layer, since the canvas is the picture', async () => {
    const document = await newDocument()
    await subDocument(document.id, [createSharpStep('flip')])

    const job = await t.app.renders.requestExport(t.ann, document.id, {
      format: ExportFormat.Png,
      options: {},
      keepMetadata: false,
    })

    expect(job.kind).toBe(JobKind.Export)
  })

  it('run an AI step on the sub-document’s picture and not on the canvas', async () => {
    const logo = await t.uploadImage(t.ann, '#cc0000', 'logo.png')
    const document = await newDocument()
    const flip = createSharpStep('flip')
    const ai = createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS })
    await subDocument(document.id, [createImageLayerStep(logo.id), flip, ai])

    const waiting = await previewOf(document.id)
    expect(waiting.pendingStepIds).toEqual([ai.id])
    const done = await run(
      await t.app.renders.requestAiStep(t.ann, document.id, ai.id),
    )

    expect(done.state).toBe(JobState.Done)
    const aiInput = t.imageEngine.requests.find(
      ({ target }) => target.kind === 'intermediate',
    )
    expect(aiInput?.steps).toMatchObject([{ kind: 'layer' }, { op: 'flip' }])
    const after = await previewOf(document.id)
    expect(after.pendingStepIds).toEqual([])
    expect(after.key).not.toBe(waiting.key)
  })

  it('wait for an AI step on the canvas that comes before them', async () => {
    const logo = await t.uploadImage(t.ann, '#cc0000', 'logo.png')
    const document = await newDocument()
    const first = createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS })
    const inner = createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS })
    await addAll(document.id, [first])
    await subDocument(document.id, [createImageLayerStep(logo.id), inner])

    await expect(
      t.app.renders.requestAiStep(t.ann, document.id, inner.id),
    ).rejects.toBeInstanceOf(ValidationError)
    expect((await previewOf(document.id)).pendingStepIds).toEqual([
      first.id,
      inner.id,
    ])
  })

  it('get a picture of their own in the small pictures, and one for each step in them', async () => {
    const logo = await t.uploadImage(t.ann, '#cc0000', 'logo.png')
    const document = await newDocument()
    const flip = createSharpStep('flip')
    const layer = createImageLayerStep(logo.id)
    const group = await subDocument(document.id, [layer, flip])

    const done = await run(
      await t.app.renders.requestThumbnails(t.ann, document.id),
    )

    if (done.result?.kind !== JobKind.Thumbnail) throw new Error('wrong result')
    const keys = new Map(
      done.result.thumbnails.map(({ stepId, key }) => [stepId, key]),
    )
    for (const id of [group.id, layer.id, flip.id]) {
      expect(keys.get(id)).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('show no small picture for a step inside one that is switched off', async () => {
    const logo = await t.uploadImage(t.ann, '#cc0000', 'logo.png')
    const document = await newDocument()
    const flip = createSharpStep('flip')
    await subDocument(document.id, [createImageLayerStep(logo.id), flip], false)

    const done = await run(
      await t.app.renders.requestThumbnails(t.ann, document.id, [flip.id]),
    )

    if (done.result?.kind !== JobKind.Thumbnail) throw new Error('wrong result')
    expect(done.result.thumbnails).toEqual([{ stepId: flip.id, key: null }])
  })
})
