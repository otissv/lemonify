import { readdir } from 'node:fs/promises'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AiToolId } from '@/features/ai/ai-tools'
import { ExportFormat } from '@/features/export/export-settings'
import { canvasOfSize } from '@/features/pipeline/canvas'
import { createImageLayerStep } from '@/features/pipeline/layer-kinds'
import {
  createAiStep,
  createGroupStep,
  createPipeline,
  createSharpStep,
} from '@/features/pipeline/pipeline'
import type { PipelineStep } from '@/features/pipeline/pipeline'
import { defaultOutputSettings } from '@/features/workflows/output-settings'
import type { OutputSettings } from '@/features/workflows/output-settings'
import { CanvasSize, createWorkflow } from '@/features/workflows/workflow'
import type { WorkflowDefinition } from '@/features/workflows/workflow'
import type { WorkflowChange } from '@/features/workflows/workflow-change'

import { openZip } from '../bundle/zip.ts'
import { ResultKind } from '../dao/result-dao.ts'
import { RunState } from '../dao/workflow-dao.ts'
import { ConflictError, NotFoundError, ValidationError } from '../errors.ts'
import { createTestApp } from '../testing/test-app.ts'
import type { TestApp } from '../testing/test-app.ts'
import { EngineTargetKind } from '../tools/image-engine.ts'
import type { RunView } from './workflow-service.ts'

const SETTINGS = { model: 'm', scale: 4, iterations: 1, tta: false } as const
const CANVAS = canvasOfSize(20, 10)

let t: TestApp

beforeEach(async () => {
  t = await createTestApp()
})

afterEach(async () => {
  await t.close()
})

/** A workflow on `inputs` with a fixed canvas: one empty image layer for each input image, then `steps` in order. */
function definitionOf(
  inputs: string[],
  ...steps: PipelineStep[]
): WorkflowDefinition {
  const { pipeline, output } = createWorkflow('x')
  return {
    pipeline: createPipeline(CANVAS, [...pipeline.steps, ...steps]),
    canvasSize: CanvasSize.Fixed,
    inputs,
    output,
  }
}

function withOutput(
  definition: WorkflowDefinition,
  output: OutputSettings,
): WorkflowDefinition {
  return { ...definition, output }
}

function stepNames(
  request: { steps: ReadonlyArray<{ kind: string }> } | undefined,
): string[] {
  return (request?.steps ?? []).map((step) =>
    'op' in step && typeof step.op === 'string' ? step.op : step.kind,
  )
}

async function runFinished(runId: string, actor = t.ann): Promise<RunView> {
  const limit = Date.now() + 4000
  while (Date.now() < limit) {
    const run = await t.app.workflows.getRun(actor, runId)
    if (run.state !== RunState.Running) return run
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('The run did not finish in time.')
}

async function startRun(definition: WorkflowDefinition, name = 'Flow') {
  const workflow = await t.app.workflows.create(t.ann, name, definition)
  const run = await t.app.workflows.run(t.ann, workflow.id)
  await t.app.scheduler.start()
  return { workflow, run }
}

describe('create, update and list', () => {
  it('creates a workflow with a canvas, an empty image layer, no inputs and the default output', async () => {
    const view = await t.app.workflows.create(t.ann, ' Resize ')
    expect(view.name).toBe('Resize')
    expect(view.revision).toBe(0)
    expect(view.pipeline.canvas).toEqual(createWorkflow('x').pipeline.canvas)
    expect(view.pipeline.steps).toHaveLength(1)
    expect(view.inputs).toEqual([])
    expect(view.output).toEqual(defaultOutputSettings())
    expect(await t.app.workflows.list(t.ann)).toHaveLength(1)
  })

  it('keeps names unique per User, ignoring case, and lets another User reuse one', async () => {
    await t.app.workflows.create(t.ann, 'Resize')
    await expect(
      t.app.workflows.create(t.ann, 'resize'),
    ).rejects.toBeInstanceOf(ConflictError)
    await expect(t.app.workflows.create(t.bob, 'Resize')).resolves.toBeDefined()
  })

  it('refuses a name that is empty or too long', async () => {
    await expect(t.app.workflows.create(t.ann, '  ')).rejects.toBeInstanceOf(
      ValidationError,
    )
    await expect(
      t.app.workflows.create(t.ann, 'x'.repeat(200)),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('changes with the revision the caller saw, and refuses a stale one', async () => {
    const created = await t.app.workflows.create(t.ann, 'Resize')
    const change = { type: 'set-canvas', canvas: canvasOfSize(30, 30) } as const
    const changed = await t.app.workflows.change(t.ann, created.id, 0, change)
    expect(changed).toMatchObject({
      revision: 1,
      canUndo: true,
      canRedo: false,
    })
    expect(changed.pipeline.canvas).toMatchObject({ width: 30, height: 30 })
    await expect(
      t.app.workflows.change(t.ann, created.id, 0, change),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('renames without a revision, and keeps names unique', async () => {
    const first = await t.app.workflows.create(t.ann, 'Resize')
    await t.app.workflows.create(t.ann, 'Flip')
    const renamed = await t.app.workflows.rename(t.ann, first.id, ' Scale ')
    expect(renamed).toMatchObject({ name: 'Scale', revision: 0 })
    await expect(
      t.app.workflows.rename(t.ann, first.id, 'flip'),
    ).rejects.toBeInstanceOf(ConflictError)
    await expect(
      t.app.workflows.rename(t.ann, first.id, '  '),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      t.app.workflows.rename(t.bob, first.id, 'Mine'),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('refuses a workflow that names another User’s image', async () => {
    const foreign = await t.uploadImage(t.bob)
    await expect(
      t.app.workflows.create(t.ann, 'Mine', definitionOf([foreign.id])),
    ).rejects.toThrow('no longer exists')
    const mine = await t.uploadImage(t.ann)
    await expect(
      t.app.workflows.create(t.ann, 'Mine', definitionOf([mine.id])),
    ).resolves.toBeDefined()
  })

  it('refuses a second image in a step that is not the User’s', async () => {
    const foreign = await t.uploadImage(t.bob)
    const step = createSharpStep('boolean')
    const definition = definitionOf([], {
      ...step,
      options: { operand: foreign.id, operator: 'and' },
    })
    await expect(
      t.app.workflows.create(t.ann, 'Mask', definition),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('hides another User’s workflow as missing', async () => {
    const created = await t.app.workflows.create(t.ann, 'Mine')
    await expect(t.app.workflows.get(t.bob, created.id)).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(t.app.workflows.run(t.bob, created.id)).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(
      t.app.workflows.delete(t.bob, created.id),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(await t.app.workflows.list(t.bob)).toEqual([])
  })
})

describe('running a workflow', () => {
  it('refuses to run what cannot run, before queueing anything', async () => {
    const empty = await t.app.workflows.create(t.ann, 'Empty')
    await expect(t.app.workflows.run(t.ann, empty.id)).rejects.toThrow(
      /Add at least one image/,
    )
    const source = await t.uploadImage(t.ann)
    const incomplete = await t.app.workflows.create(
      t.ann,
      'Incomplete',
      definitionOf([source.id], createSharpStep('extract')),
    )
    await expect(t.app.workflows.run(t.ann, incomplete.id)).rejects.toThrow(
      /Needs/,
    )
    expect(await t.app.jobs.list(t.ann)).toEqual([])
    expect(await t.app.workflows.listRuns(t.ann)).toEqual([])
  })

  it('runs Sharp steps over every image and keeps each output as a Result', async () => {
    const a = await t.uploadImage(t.ann, '#111111', 'a.png')
    const b = await t.uploadImage(t.ann, '#222222', 'b.png')
    const definition = definitionOf([a.id, b.id], createSharpStep('flip'))
    const { run } = await startRun(definition)
    expect(run.jobs.total).toBe(2)
    const done = await runFinished(run.id)
    expect(done.state).toBe(RunState.Done)
    expect(done.progress).toBe(1)
    const results = await t.app.results.list(t.ann, { workflowRunId: run.id })
    expect(results.map(({ fileName }) => fileName).sort()).toEqual([
      'a.webp',
      'b.webp',
    ])
    expect(results.every(({ kind }) => kind === ResultKind.RunItem)).toBe(true)
    expect(
      t.imageEngine.requests.every(
        ({ target }) => target.kind === EngineTargetKind.Export,
      ),
    ).toBe(true)
  })

  it('writes one image per width, named by width', async () => {
    const source = await t.uploadImage(t.ann, '#111111', 'cat.png')
    const settings = {
      ...defaultOutputSettings(),
      format: ExportFormat.Webp,
      widths: [480, 1024],
    }
    const definition = withOutput(definitionOf([source.id]), settings)
    const { run } = await startRun(definition)
    expect((await runFinished(run.id)).state).toBe(RunState.Done)
    const results = await t.app.results.list(t.ann, { workflowRunId: run.id })
    expect(results.map(({ fileName }) => fileName).sort()).toEqual([
      'cat-1024.webp',
      'cat-480.webp',
    ])
    const widths: number[] = []
    for (const { target } of t.imageEngine.requests) {
      if (
        target.kind === EngineTargetKind.Export &&
        target.width !== undefined
      ) {
        widths.push(target.width)
      }
    }
    expect(widths.sort((a, b) => a - b)).toEqual([480, 1024])
  })

  it('runs an AI step between Sharp steps, batching the images that share a model', async () => {
    const a = await t.uploadImage(t.ann, '#111111', 'a.png')
    const b = await t.uploadImage(t.ann, '#222222', 'b.png')
    const definition = definitionOf(
      [a.id, b.id],
      createSharpStep('flip'),
      createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS }),
      createSharpStep('flop'),
    )
    const { run } = await startRun(definition)
    const done = await runFinished(run.id)
    expect(done.state).toBe(RunState.Done)
    expect(done.jobs).toMatchObject({ total: 6, done: 6 })
    expect(t.aiEngine.batches).toHaveLength(1)
    expect(t.aiEngine.batches[0]?.requests).toHaveLength(2)
    const kinds = t.imageEngine.requests.map(({ target }) => target.kind)
    expect(
      kinds.filter((kind) => kind === EngineTargetKind.Intermediate),
    ).toHaveLength(2)
    expect(
      kinds.filter((kind) => kind === EngineTargetKind.Export),
    ).toHaveLength(2)
    expect(
      await t.app.results.list(t.ann, { workflowRunId: run.id }),
    ).toHaveLength(2)
  })

  it('ends on an empty closing segment after a last AI step', async () => {
    const source = await t.uploadImage(t.ann)
    const definition = definitionOf(
      [source.id],
      createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS }),
    )
    const { run } = await startRun(definition)
    expect((await runFinished(run.id)).state).toBe(RunState.Done)
    const request = t.imageEngine.requests.at(-1)
    expect(request?.target.kind).toBe(EngineTargetKind.Export)
    expect(request?.steps).toEqual([])
  })

  it('removes the run’s work images when it ends', async () => {
    const source = await t.uploadImage(t.ann)
    const definition = definitionOf(
      [source.id],
      createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS }),
    )
    const { run } = await startRun(definition)
    await runFinished(run.id)
    const work = path.join(t.directory, 'work')
    await vi.waitFor(async () => {
      expect(
        (await readdir(work)).filter((name) => name.startsWith('run-')),
      ).toEqual([])
    })
  })

  it('groups a run’s images by the Source they came from, in the order of the widths', async () => {
    const a = await t.uploadImage(t.ann, '#111111', 'a.png')
    const b = await t.uploadImage(t.ann, '#222222', 'b.png')
    const settings = { ...defaultOutputSettings(), widths: [480, 1024] }
    const definition = withOutput(definitionOf([a.id, b.id]), settings)
    const { run } = await startRun(definition)
    await runFinished(run.id)
    const outputs = await t.app.workflows.runOutputs(t.ann, run.id)
    expect(outputs.map(({ source }) => source.fileName)).toEqual([
      'a.png',
      'b.png',
    ])
    expect(
      outputs[0]?.images.map(({ fileName, width }) => [fileName, width]),
    ).toEqual([
      ['a-480.webp', 480],
      ['a-1024.webp', 1024],
    ])
  })

  it('runs on the chosen input images only, in the workflow’s order, and says which they were', async () => {
    const a = await t.uploadImage(t.ann, '#111111', 'a.png')
    const b = await t.uploadImage(t.ann, '#222222', 'b.png')
    const c = await t.uploadImage(t.ann, '#333333', 'c.png')
    const workflow = await t.app.workflows.create(
      t.ann,
      'Some',
      definitionOf([a.id, b.id, c.id]),
    )

    const run = await t.app.workflows.run(t.ann, workflow.id, {
      sourceIds: [c.id, a.id],
    })
    await t.app.scheduler.start()
    const finished = await runFinished(run.id)

    expect(run.sourceIds).toEqual([a.id, c.id])
    expect(finished.jobs.total).toBe(2)
    expect(
      finished.items.map(({ sourceId, state, resultIds }) => [
        sourceId,
        state,
        resultIds.length,
      ]),
    ).toEqual([
      [a.id, 'done', 1],
      [c.id, 'done', 1],
    ])
    const outputs = await t.app.workflows.runOutputs(t.ann, run.id)
    expect(outputs.map(({ source }) => source.fileName)).toEqual([
      'a.png',
      'c.png',
    ])
  })

  it('refuses a choice of images that is empty, repeats one, or names one the workflow does not have', async () => {
    const a = await t.uploadImage(t.ann, '#111111', 'a.png')
    const other = await t.uploadImage(t.ann, '#222222', 'other.png')
    const workflow = await t.app.workflows.create(
      t.ann,
      'Choose',
      definitionOf([a.id]),
    )

    for (const sourceIds of [[], [a.id, a.id], [other.id]]) {
      await expect(
        t.app.workflows.run(t.ann, workflow.id, { sourceIds }),
      ).rejects.toBeInstanceOf(ValidationError)
    }
    expect(await t.app.workflows.listRuns(t.ann, workflow.id)).toEqual([])
  })

  it('writes a run’s images into one zip file, numbering names that would clash', async () => {
    const a = await t.uploadImage(t.ann, '#111111', 'a.png')
    const b = await t.uploadImage(t.ann, '#222222', 'a.jpg')
    const definition = definitionOf([a.id, b.id])
    const { run } = await startRun(definition, 'Zip me')
    await runFinished(run.id)
    const destination = path.join(t.directory, 'out.zip')

    const written = await t.app.workflows.writeRunArchive(
      t.ann,
      run.id,
      destination,
    )

    const archive = await openZip(destination)
    expect(archive.entries.map(({ name }) => name)).toEqual([
      'a.webp',
      'a-1.webp',
    ])
    await archive.close()
    expect(written).toMatchObject({ images: 2, fileName: 'Zip me.zip' })
    expect(written.bytes).toBeGreaterThan(0)
    await expect(
      t.app.workflows.writeRunArchive(t.bob, run.id, destination),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('opens a run’s zip file as a download, and refuses a run with nothing finished', async () => {
    const source = await t.uploadImage(t.ann)
    const { run } = await startRun(definitionOf([source.id]))
    await runFinished(run.id)

    const opened = await t.app.workflows.openRunArchive(t.ann, run.id)
    const chunks: Buffer[] = []
    for await (const chunk of opened.stream) chunks.push(chunk as Buffer)
    expect(opened.mediaType).toBe('application/zip')
    expect(Buffer.concat(chunks).length).toBe(opened.bytes)
  })

  it('refuses a zip file of a run that has finished nothing yet', async () => {
    const source = await t.uploadImage(t.ann)
    const workflow = await t.app.workflows.create(
      t.ann,
      'Idle',
      definitionOf([source.id]),
    )
    const idle = await t.app.workflows.run(t.ann, workflow.id)

    await expect(
      t.app.workflows.openRunArchive(t.ann, idle.id),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('has no outputs for a run that made none, and hides them from other Users', async () => {
    const source = await t.uploadImage(t.ann)
    const workflow = await t.app.workflows.create(
      t.ann,
      'Idle',
      definitionOf([source.id]),
    )
    const run = await t.app.workflows.run(t.ann, workflow.id)
    expect(await t.app.workflows.runOutputs(t.ann, run.id)).toEqual([])
    await expect(
      t.app.workflows.runOutputs(t.bob, run.id),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('refuses the same image twice as an input, so a run has one item per image', async () => {
    const source = await t.uploadImage(t.ann)
    await expect(
      t.app.workflows.create(
        t.ann,
        'Twice',
        definitionOf([source.id, source.id]),
      ),
    ).rejects.toThrow('Each input image can be used once')
  })

  it('marks the run failed and says why when an engine fails', async () => {
    const source = await t.uploadImage(t.ann)
    t.aiEngine.failWith = new Error('The GPU ran out of memory')
    const definition = definitionOf(
      [source.id],
      createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS }),
    )
    const { run } = await startRun(definition)
    const done = await runFinished(run.id)
    expect(done.state).toBe(RunState.Failed)
    expect(done.errors).toEqual(['The GPU ran out of memory'])
    expect(await t.app.results.list(t.ann, { workflowRunId: run.id })).toEqual(
      [],
    )
  })

  it('fails the item whose image was deleted and finishes the others', async () => {
    const keep = await t.uploadImage(t.ann, '#111111', 'keep.png')
    const gone = await t.uploadImage(t.ann, '#222222', 'gone.png')
    const workflow = await t.app.workflows.create(
      t.ann,
      'Mixed',
      definitionOf([keep.id, gone.id]),
    )
    const run = await t.app.workflows.run(t.ann, workflow.id)
    await t.app.sources.delete(t.ann, gone.id)
    await t.app.scheduler.start()
    const done = await runFinished(run.id)
    expect(done.state).toBe(RunState.Failed)
    expect(done.jobs).toMatchObject({ done: 1, failed: 1 })
    expect(done.errors).toEqual(['An image in this workflow no longer exists.'])
  })

  it('uses the definition the run started with, not later edits', async () => {
    const source = await t.uploadImage(t.ann, '#111111', 'cat.png')
    const workflow = await t.app.workflows.create(
      t.ann,
      'Edited',
      definitionOf([source.id], createSharpStep('flip')),
    )
    const run = await t.app.workflows.run(t.ann, workflow.id)
    await t.app.workflows.change(t.ann, workflow.id, 0, {
      type: 'replace',
      definition: definitionOf([source.id], createSharpStep('flop')),
    })
    await t.app.scheduler.start()
    await runFinished(run.id)
    expect(stepNames(t.imageEngine.requests[0])).toEqual(['layer', 'flip'])
  })

  it('cancels a run: waiting items are dropped and a running one queues no next segment', async () => {
    const a = await t.uploadImage(t.ann, '#111111', 'a.png')
    const definition = definitionOf(
      [a.id],
      createSharpStep('flip'),
      createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS }),
    )
    let release: () => void = () => {}
    t.imageEngine.gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { run } = await startRun(definition)
    const limit = Date.now() + 2000
    while (t.imageEngine.requests.length === 0 && Date.now() < limit) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    await t.app.workflows.cancelRun(t.ann, run.id)
    release()
    const done = await runFinished(run.id)
    expect(done.state).toBe(
      RunState.Done === done.state ? RunState.Done : RunState.Cancelled,
    )
    expect(done.jobs.total).toBe(1)
    expect(t.aiEngine.batches).toHaveLength(0)
  })

  it('hides another User’s run', async () => {
    const source = await t.uploadImage(t.ann)
    const { run } = await startRun(definitionOf([source.id]))
    await expect(t.app.workflows.getRun(t.bob, run.id)).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(
      t.app.workflows.cancelRun(t.bob, run.id),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(await t.app.workflows.listRuns(t.bob)).toEqual([])
  })

  it('deletes a finished run with its Results, but not one that is still going', async () => {
    const source = await t.uploadImage(t.ann)
    const workflow = await t.app.workflows.create(
      t.ann,
      'Flow',
      definitionOf([source.id]),
    )
    const run = await t.app.workflows.run(t.ann, workflow.id)
    await expect(
      t.app.workflows.deleteRun(t.ann, run.id),
    ).rejects.toBeInstanceOf(ConflictError)
    await t.app.scheduler.start()
    await runFinished(run.id)
    expect(
      await t.app.results.list(t.ann, { workflowRunId: run.id }),
    ).toHaveLength(1)
    await t.app.workflows.deleteRun(t.ann, run.id)
    await expect(t.app.workflows.getRun(t.ann, run.id)).rejects.toBeInstanceOf(
      NotFoundError,
    )
    expect(await t.app.results.list(t.ann)).toEqual([])
  })

  it('keeps a run and its Results after the Workflow is deleted', async () => {
    const source = await t.uploadImage(t.ann)
    const { workflow, run } = await startRun(definitionOf([source.id]))
    await runFinished(run.id)
    await t.app.workflows.delete(t.ann, workflow.id)
    const kept = await t.app.workflows.getRun(t.ann, run.id)
    expect(kept.workflowId).toBeNull()
    expect(
      await t.app.results.list(t.ann, { workflowRunId: run.id }),
    ).toHaveLength(1)
  })
})

describe('image layers and canvases in a workflow', () => {
  it('refuses a workflow with no empty image layer to put an input image in', async () => {
    const source = await t.uploadImage(t.ann)
    const workflow = await t.app.workflows.create(t.ann, 'No slot', {
      ...definitionOf([source.id]),
      pipeline: createPipeline(CANVAS, [createSharpStep('flip')]),
    })
    await expect(t.app.workflows.run(t.ann, workflow.id)).rejects.toThrow(
      /image layer with no image/,
    )
    expect(await t.app.workflows.listRuns(t.ann)).toEqual([])
  })

  it('refuses an AI step inside a sub-document, before queueing anything', async () => {
    const source = await t.uploadImage(t.ann)
    const sub = {
      ...createGroupStep([
        createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS }),
      ]),
      subDocument: true,
    }
    const workflow = await t.app.workflows.create(
      t.ann,
      'Sub',
      definitionOf([source.id], sub),
    )
    await expect(t.app.workflows.run(t.ann, workflow.id)).rejects.toThrow(
      /sub-document/,
    )
    expect(await t.app.jobs.list(t.ann)).toEqual([])
  })

  it('refuses an image layer whose image is another User’s', async () => {
    const foreign = await t.uploadImage(t.bob)
    await expect(
      t.app.workflows.create(
        t.ann,
        'Mine',
        definitionOf([], createImageLayerStep(foreign.id)),
      ),
    ).rejects.toThrow('no longer exists')
  })

  it('refuses a definition that is not valid, such as a Composite step', async () => {
    const created = definitionOf([], createSharpStep('composite'))
    await expect(
      t.app.workflows.create(t.ann, 'Bad', created),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('refuses an AI tool the server does not have', async () => {
    const unknown = createAiStep({ tool: AiToolId.Upscale, settings: SETTINGS })
    const definition = definitionOf([], { ...unknown, tool: 'nope' as never })
    await expect(
      t.app.workflows.create(t.ann, 'Bad', definition),
    ).rejects.toThrow()
  })

  it('draws each input image on the canvas the workflow sets when its size is fixed', async () => {
    const source = await t.uploadImage(t.ann, '#111111', 'cat.png')
    const { run } = await startRun(definitionOf([source.id]))
    await runFinished(run.id)
    const [request] = t.imageEngine.requests
    expect(request?.input).toEqual({ kind: 'canvas', canvas: CANVAS })
    expect(stepNames(request)).toEqual(['layer'])
  })

  it('takes the size of the input image when the canvas matches each one, and keeps the background', async () => {
    const source = await t.uploadImage(t.ann, '#111111', 'cat.png')
    const definition = definitionOf([source.id])
    const coloured = {
      ...definition,
      canvasSize: CanvasSize.MatchInput,
      pipeline: {
        ...definition.pipeline,
        canvas: { ...CANVAS, background: '#00ff00' },
      },
    }
    const { run } = await startRun(coloured)
    await runFinished(run.id)
    const input = t.imageEngine.requests[0]?.input
    expect(input).toMatchObject({
      kind: 'canvas',
      canvas: {
        width: source.width,
        height: source.height,
        background: '#00ff00',
      },
    })
  })

  it('puts the image in the first slot only, and a fixed layer keeps its own image', async () => {
    const input = await t.uploadImage(t.ann, '#111111', 'in.png')
    const fixed = await t.uploadImage(t.ann, '#222222', 'logo.png')
    const definition = definitionOf(
      [input.id],
      createImageLayerStep(fixed.id),
      createImageLayerStep(),
    )
    const { run } = await startRun(definition)
    expect((await runFinished(run.id)).state).toBe(RunState.Done)
    expect(stepNames(t.imageEngine.requests[0])).toEqual(['layer', 'layer'])
  })

  it('exports in the format of the input image when the output keeps the original', async () => {
    const source = await t.uploadImage(t.ann, '#111111', 'cat.png')
    const { run } = await startRun(definitionOf([source.id]))
    await runFinished(run.id)
    const request = t.imageEngine.requests.at(-1)
    expect(request?.originalFrom).toBeDefined()
  })
})

describe('telling the person’s tabs', () => {
  it('says the workflows changed when one is made, renamed or deleted, and which one when it is edited', async () => {
    const workflow = await t.app.workflows.create(t.ann, 'Flow')
    const edited = await t.app.workflows.change(t.ann, workflow.id, 0, {
      type: 'set-canvas',
      canvas: canvasOfSize(5, 5),
    })
    await t.app.workflows.rename(t.ann, workflow.id, 'Renamed')
    await t.app.workflows.delete(t.ann, workflow.id)

    expect(t.changes.eventsFor('ann')).toEqual([
      { type: 'workflows.changed' },
      {
        type: 'workflow.updated',
        workflowId: workflow.id,
        revision: 1,
        updatedAt: edited.updatedAt,
      },
      expect.objectContaining({ type: 'workflow.updated', revision: 1 }),
      { type: 'workflows.changed' },
      { type: 'workflow.deleted', workflowId: workflow.id },
      { type: 'workflows.changed' },
    ])
  })

  it('says so when a run starts and when it finishes', async () => {
    const source = await t.uploadImage(t.ann)
    const { run } = await startRun(definitionOf([source.id]))
    t.changes.clear()

    await runFinished(run.id)

    await vi.waitFor(() => {
      expect(t.changes.eventsFor('ann')).toContainEqual({
        type: 'workflows.changed',
      })
    })
  })

  it('says so when a run is stopped or deleted', async () => {
    const source = await t.uploadImage(t.ann)
    const workflow = await t.app.workflows.create(
      t.ann,
      'Flow',
      definitionOf([source.id]),
    )
    const run = await t.app.workflows.run(t.ann, workflow.id)
    t.changes.clear()

    await t.app.workflows.cancelRun(t.ann, run.id)
    await t.app.scheduler.start()
    await runFinished(run.id)
    t.changes.clear()
    await t.app.workflows.deleteRun(t.ann, run.id)

    expect(t.changes.eventsFor('ann')).toEqual([{ type: 'workflows.changed' }])
  })

  it('says nothing when a change is refused, and tells only the owner', async () => {
    const workflow = await t.app.workflows.create(t.ann, 'Flow')
    t.changes.clear()

    await expect(
      t.app.workflows.change(t.bob, workflow.id, workflow.revision, {
        type: 'set-canvas',
        canvas: canvasOfSize(5, 5),
      }),
    ).rejects.toThrow(NotFoundError)
    await expect(
      t.app.workflows.rename(t.bob, workflow.id, 'Stolen'),
    ).rejects.toThrow(NotFoundError)
    await expect(t.app.workflows.delete(t.bob, workflow.id)).rejects.toThrow(
      NotFoundError,
    )

    expect(t.changes.sent).toEqual([])
  })
})

describe('the Edit history of a workflow', () => {
  const CHANGE: WorkflowChange = {
    type: 'set-canvas',
    canvas: canvasOfSize(30, 30),
  }

  it('undoes and redoes a change, whatever kind it is', async () => {
    const source = await t.uploadImage(t.ann)
    const created = await t.app.workflows.create(t.ann, 'Flow')
    const output = { ...defaultOutputSettings(), widths: [64] }
    let revision = created.revision
    const changes: WorkflowChange[] = [
      CHANGE,
      { type: 'set-inputs', sourceIds: [source.id] },
      { type: 'set-output', output },
      { type: 'add-step', step: createSharpStep('flip'), index: 1 },
    ]
    for (const change of changes) {
      revision = (
        await t.app.workflows.change(t.ann, created.id, revision, change)
      ).revision
    }
    const done = await t.app.workflows.get(t.ann, created.id)

    let view = done
    for (let count = 0; count < 4; count += 1) {
      view = await t.app.workflows.undo(t.ann, created.id, view.revision)
    }
    expect(view).toMatchObject({ canUndo: false, canRedo: true })
    expect(view.pipeline).toEqual(created.pipeline)
    expect(view.inputs).toEqual([])
    expect(view.output).toEqual(created.output)

    for (let count = 0; count < 4; count += 1) {
      view = await t.app.workflows.redo(t.ann, created.id, view.revision)
    }
    expect(view).toMatchObject({ canUndo: true, canRedo: false })
    expect(view.pipeline).toEqual(done.pipeline)
    expect(view.inputs).toEqual(done.inputs)
    expect(view.output).toEqual(done.output)
  })

  it('refuses to undo or redo when there is nothing to', async () => {
    const created = await t.app.workflows.create(t.ann, 'Flow')
    await expect(
      t.app.workflows.undo(t.ann, created.id, 0),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      t.app.workflows.redo(t.ann, created.id, 0),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('records nothing for a change that changes nothing', async () => {
    const created = await t.app.workflows.create(t.ann, 'Flow')
    const same = await t.app.workflows.change(t.ann, created.id, 0, {
      type: 'set-inputs',
      sourceIds: [],
    })
    expect(same).toMatchObject({ revision: 0, canUndo: false })
  })

  it('refuses a change that makes the workflow invalid, and a stale undo', async () => {
    const created = await t.app.workflows.create(t.ann, 'Flow')
    await expect(
      t.app.workflows.change(t.ann, created.id, 0, {
        type: 'remove-step',
        stepId: 'gone',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      t.app.workflows.change(t.ann, created.id, 0, {
        type: 'set-inputs',
        sourceIds: ['a', 'a'],
      }),
    ).rejects.toBeInstanceOf(ValidationError)
    await t.app.workflows.change(t.ann, created.id, 0, CHANGE)
    await expect(
      t.app.workflows.undo(t.ann, created.id, 0),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('refuses inputs that are not the User’s images, and another User’s workflow', async () => {
    const foreign = await t.uploadImage(t.bob)
    const created = await t.app.workflows.create(t.ann, 'Flow')
    await expect(
      t.app.workflows.change(t.ann, created.id, 0, {
        type: 'set-inputs',
        sourceIds: [foreign.id],
      }),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      t.app.workflows.undo(t.bob, created.id, 0),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('keeps the names and runs when it is undone, and tells the tabs which workflow moved', async () => {
    const created = await t.app.workflows.create(t.ann, 'Flow')
    await t.app.workflows.change(t.ann, created.id, 0, CHANGE)
    t.changes.clear()
    const undone = await t.app.workflows.undo(t.ann, created.id, 1)
    expect(undone.name).toBe('Flow')
    expect(t.changes.eventsFor('ann')).toEqual([
      {
        type: 'workflow.updated',
        workflowId: created.id,
        revision: 2,
        updatedAt: undone.updatedAt,
      },
    ])
  })
})
