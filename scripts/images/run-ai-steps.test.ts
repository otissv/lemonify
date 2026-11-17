// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AiToolId } from '../../src/features/ai/ai-tools.ts'
import {
  createAiStep,
  createSharpStep,
} from '../../src/features/pipeline/pipeline.ts'
import type { PipelineStep } from '../../src/features/pipeline/pipeline.ts'
import {
  ConflictError,
  JobFailedError,
  ValidationError,
} from '../../src/server/errors.ts'
import { createTestApp } from '../../src/server/testing/test-app.ts'
import type { TestApp } from '../../src/server/testing/test-app.ts'
import { runAiSteps } from './run-ai-steps.ts'

const SETTINGS = { model: 'm', scale: 4, iterations: 1, tta: false } as const

let t: TestApp

beforeEach(async () => {
  t = await createTestApp()
  await t.app.scheduler.start()
})

afterEach(async () => {
  await t.close()
})

async function newDocument() {
  const source = await t.uploadImage(t.ann)
  return t.app.documents.create(t.ann, source.id)
}

async function addStep(documentId: string, step: PipelineStep) {
  const view = await t.app.documents.get(t.ann, documentId)
  await t.app.documents.change(t.ann, documentId, view.revision, {
    type: 'add-step',
    step,
    index: view.pipeline.steps.length,
  })
}

describe('runAiSteps', () => {
  it('runs every AI step that has no result yet, in order', async () => {
    const document = await newDocument()
    const first = createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS })
    const second = createAiStep({
      tool: AiToolId.Upscale,
      settings: { ...SETTINGS, scale: 2 },
    })
    await addStep(document.id, first)
    await addStep(document.id, createSharpStep('flop'))
    await addStep(document.id, second)

    const done = await runAiSteps(t.app, t.ann, document.id)

    expect(done.ran).toEqual([first.id, second.id])
    expect(t.aiEngine.batches).toHaveLength(2)
  })

  it('runs nothing when no step is waiting', async () => {
    const document = await newDocument()
    await addStep(document.id, createSharpStep('flop'))

    expect((await runAiSteps(t.app, t.ann, document.id)).ran).toEqual([])
    expect(t.aiEngine.batches).toHaveLength(0)
  })

  it('runs only the step it is told to', async () => {
    const document = await newDocument()
    const first = createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS })
    const second = createAiStep({
      tool: AiToolId.Upscale,
      settings: { ...SETTINGS, scale: 2 },
    })
    await addStep(document.id, first)
    await addStep(document.id, second)

    const done = await runAiSteps(t.app, t.ann, document.id, first.id)

    expect(done.ran).toEqual([first.id])
    expect(t.aiEngine.batches).toHaveLength(1)
  })

  it('refuses to run a step before the ones ahead of it', async () => {
    const document = await newDocument()
    await addStep(
      document.id,
      createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS }),
    )
    const second = createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS })
    await addStep(document.id, second)

    await expect(
      runAiSteps(t.app, t.ann, document.id, second.id),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('refuses to run a step again once it has a result', async () => {
    const document = await newDocument()
    const step = createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS })
    await addStep(document.id, step)
    await runAiSteps(t.app, t.ann, document.id)

    await expect(
      runAiSteps(t.app, t.ann, document.id, step.id),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('stops with the engine’s message when a step fails', async () => {
    const document = await newDocument()
    await addStep(
      document.id,
      createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS }),
    )
    t.aiEngine.failWith = new Error('The GPU ran out of memory')

    const failure = await runAiSteps(t.app, t.ann, document.id).catch(
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(JobFailedError)
    expect((failure as Error).message).toContain('The GPU ran out of memory')
  })
})
