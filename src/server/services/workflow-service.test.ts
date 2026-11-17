import { readdir } from 'node:fs/promises'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AiToolId } from '@/features/ai/ai-tools'
import { ExportFormat } from '@/features/export/export-settings'
import { createWorkflow } from '@/features/workflows/workflow'
import type { WorkflowGraph } from '@/features/workflows/workflow'
import {
  WorkflowNodeKind,
  addInputSources,
  appendStep,
  createAiNode,
  createSharpNode,
  updateOutputSettings,
} from '@/features/workflows/workflow-graph'
import type { WorkflowNode } from '@/features/workflows/workflow-graph'
import { defaultOutputSettings } from '@/features/workflows/output-settings'

import { ResultKind } from '../dao/result-dao.ts'
import { RunState } from '../dao/workflow-dao.ts'
import { ConflictError, NotFoundError, ValidationError } from '../errors.ts'
import { createTestApp } from '../testing/test-app.ts'
import type { TestApp } from '../testing/test-app.ts'
import { EngineTargetKind } from '../tools/image-engine.ts'
import type { RunView } from './workflow-service.ts'

const AT = { x: 0, y: 0 }
const SETTINGS = { model: 'm', scale: 4, iterations: 1, tta: false } as const

let t: TestApp

beforeEach(async () => {
  t = await createTestApp()
})

afterEach(async () => {
  await t.close()
})

/** A workflow on `sourceIds` with `steps` in order, Input connected through them to Output. */
function graphOf(sourceIds: string[], ...steps: WorkflowNode[]): WorkflowGraph {
  let graph = addInputSources(createWorkflow('x'), sourceIds)
  for (const step of steps) graph = appendStep(graph, step)
  const input = graph.nodes.find(({ kind }) => kind === WorkflowNodeKind.Input)
  const output = graph.nodes.find(
    ({ kind }) => kind === WorkflowNodeKind.Output,
  )
  if (steps.length === 0 && input && output) {
    graph = {
      ...graph,
      edges: [
        ...graph.edges,
        { id: crypto.randomUUID(), source: input.id, target: output.id },
      ],
    }
  }
  return { nodes: graph.nodes, edges: graph.edges }
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

async function startRun(graph: WorkflowGraph, name = 'Flow') {
  const workflow = await t.app.workflows.create(t.ann, name, graph)
  const run = await t.app.workflows.run(t.ann, workflow.id)
  await t.app.scheduler.start()
  return { workflow, run }
}

describe('create, update and list', () => {
  it('creates an empty workflow with an Input and an Output', async () => {
    const view = await t.app.workflows.create(t.ann, ' Resize ')
    expect(view.name).toBe('Resize')
    expect(view.revision).toBe(0)
    expect(view.nodes.map(({ kind }) => kind).sort()).toEqual([
      WorkflowNodeKind.Input,
      WorkflowNodeKind.Output,
    ])
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

  it('updates with the revision the caller saw, and refuses a stale one', async () => {
    const created = await t.app.workflows.create(t.ann, 'Resize')
    const changes = {
      name: 'Resize 2',
      graph: { nodes: created.nodes, edges: created.edges },
    }
    const updated = await t.app.workflows.update(t.ann, created.id, 0, changes)
    expect(updated).toMatchObject({ name: 'Resize 2', revision: 1 })
    await expect(
      t.app.workflows.update(t.ann, created.id, 0, changes),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('refuses a graph that names another User’s image', async () => {
    const foreign = await t.uploadImage(t.bob)
    await expect(
      t.app.workflows.create(t.ann, 'Mine', graphOf([foreign.id])),
    ).rejects.toThrow('no longer exists')
    const mine = await t.uploadImage(t.ann)
    await expect(
      t.app.workflows.create(t.ann, 'Mine', graphOf([mine.id])),
    ).resolves.toBeDefined()
  })

  it('refuses a second image in a step that is not the User’s', async () => {
    const foreign = await t.uploadImage(t.bob)
    const step = createSharpNode('boolean', AT)
    const graph = graphOf([], {
      ...step,
      options: { operand: foreign.id, operator: 'and' },
    })
    await expect(
      t.app.workflows.create(t.ann, 'Mask', graph),
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
      /Connect every step|Add at least one image/,
    )
    const source = await t.uploadImage(t.ann)
    const incomplete = await t.app.workflows.create(
      t.ann,
      'Incomplete',
      graphOf([source.id], createSharpNode('extract', AT)),
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
    const graph = graphOf([a.id, b.id], createSharpNode('flip', AT))
    const { run } = await startRun(graph)
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
    const graph = updateOutputSettings(graphOf([source.id]), settings)
    const { run } = await startRun(graph)
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
    const graph = graphOf(
      [a.id, b.id],
      createSharpNode('flip', AT),
      createAiNode({ tool: AiToolId.Upscale, settings: SETTINGS }, AT),
      createSharpNode('flop', AT),
    )
    const { run } = await startRun(graph)
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
    const graph = graphOf(
      [source.id],
      createAiNode({ tool: AiToolId.Upscale, settings: SETTINGS }, AT),
    )
    const { run } = await startRun(graph)
    expect((await runFinished(run.id)).state).toBe(RunState.Done)
    const request = t.imageEngine.requests.at(-1)
    expect(request?.target.kind).toBe(EngineTargetKind.Export)
    expect(request?.steps).toEqual([])
  })

  it('removes the run’s work images when it ends', async () => {
    const source = await t.uploadImage(t.ann)
    const graph = graphOf(
      [source.id],
      createAiNode({ tool: AiToolId.Upscale, settings: SETTINGS }, AT),
    )
    const { run } = await startRun(graph)
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
    const graph = updateOutputSettings(graphOf([a.id, b.id]), settings)
    const { run } = await startRun(graph)
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

  it('has no outputs for a run that made none, and hides them from other Users', async () => {
    const source = await t.uploadImage(t.ann)
    const workflow = await t.app.workflows.create(
      t.ann,
      'Idle',
      graphOf([source.id]),
    )
    const run = await t.app.workflows.run(t.ann, workflow.id)
    expect(await t.app.workflows.runOutputs(t.ann, run.id)).toEqual([])
    await expect(
      t.app.workflows.runOutputs(t.bob, run.id),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('treats the same image twice in Input as one', async () => {
    const source = await t.uploadImage(t.ann)
    const graph = graphOf([source.id, source.id])
    const workflow = await t.app.workflows.create(t.ann, 'Twice', graph)
    const run = await t.app.workflows.run(t.ann, workflow.id)
    expect(run.jobs.total).toBe(1)
  })

  it('marks the run failed and says why when an engine fails', async () => {
    const source = await t.uploadImage(t.ann)
    t.aiEngine.failWith = new Error('The GPU ran out of memory')
    const graph = graphOf(
      [source.id],
      createAiNode({ tool: AiToolId.Upscale, settings: SETTINGS }, AT),
    )
    const { run } = await startRun(graph)
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
      graphOf([keep.id, gone.id]),
    )
    const run = await t.app.workflows.run(t.ann, workflow.id)
    await t.app.sources.delete(t.ann, gone.id)
    await t.app.scheduler.start()
    const done = await runFinished(run.id)
    expect(done.state).toBe(RunState.Failed)
    expect(done.jobs).toMatchObject({ done: 1, failed: 1 })
    expect(done.errors).toEqual(['An image in this workflow no longer exists.'])
  })

  it('uses the graph the run started with, not later edits', async () => {
    const source = await t.uploadImage(t.ann, '#111111', 'cat.png')
    const workflow = await t.app.workflows.create(
      t.ann,
      'Edited',
      graphOf([source.id], createSharpNode('flip', AT)),
    )
    const run = await t.app.workflows.run(t.ann, workflow.id)
    await t.app.workflows.update(t.ann, workflow.id, 0, {
      name: 'Edited',
      graph: graphOf([source.id], createSharpNode('flop', AT)),
    })
    await t.app.scheduler.start()
    await runFinished(run.id)
    expect(
      t.imageEngine.requests[0]?.steps.map((step) =>
        step.kind === 'sharp' ? step.op : step.kind,
      ),
    ).toEqual(['flip'])
  })

  it('cancels a run: waiting items are dropped and a running one queues no next segment', async () => {
    const a = await t.uploadImage(t.ann, '#111111', 'a.png')
    const graph = graphOf(
      [a.id],
      createSharpNode('flip', AT),
      createAiNode({ tool: AiToolId.Upscale, settings: SETTINGS }, AT),
    )
    let release: () => void = () => {}
    t.imageEngine.gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { run } = await startRun(graph)
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
    const { run } = await startRun(graphOf([source.id]))
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
      graphOf([source.id]),
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
    const { workflow, run } = await startRun(graphOf([source.id]))
    await runFinished(run.id)
    await t.app.workflows.delete(t.ann, workflow.id)
    const kept = await t.app.workflows.getRun(t.ann, run.id)
    expect(kept.workflowId).toBeNull()
    expect(
      await t.app.results.list(t.ann, { workflowRunId: run.id }),
    ).toHaveLength(1)
  })
})

describe('telling the person’s tabs', () => {
  it('says the workflows changed when one is made, saved or deleted', async () => {
    const workflow = await t.app.workflows.create(t.ann, 'Flow')
    await t.app.workflows.update(t.ann, workflow.id, workflow.revision, {
      name: 'Renamed',
      graph: { nodes: workflow.nodes, edges: workflow.edges },
    })
    await t.app.workflows.delete(t.ann, workflow.id)

    expect(t.changes.eventsFor('ann')).toEqual([
      { type: 'workflows.changed' },
      { type: 'workflows.changed' },
      { type: 'workflows.changed' },
    ])
  })

  it('says so when a run starts and when it finishes', async () => {
    const source = await t.uploadImage(t.ann)
    const { run } = await startRun(graphOf([source.id]))
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
      graphOf([source.id]),
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
      t.app.workflows.update(t.bob, workflow.id, workflow.revision, {
        name: 'Stolen',
        graph: { nodes: workflow.nodes, edges: workflow.edges },
      }),
    ).rejects.toThrow(NotFoundError)
    await expect(t.app.workflows.delete(t.bob, workflow.id)).rejects.toThrow(
      NotFoundError,
    )

    expect(t.changes.sent).toEqual([])
  })
})
