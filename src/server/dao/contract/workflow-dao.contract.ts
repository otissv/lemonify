import { describe, expect, it } from 'vitest'

import { createSharpStep } from '@/features/pipeline/pipeline'
import { RunCanvasMode, createWorkflow } from '@/features/workflows/workflow'
import type { WorkflowDefinition } from '@/features/workflows/workflow'

import { ConflictError, NotFoundError } from '../../errors.ts'
import { RunState } from '../workflow-dao.ts'
import type {
  WorkflowDao,
  WorkflowRecord,
  WorkflowRunRecord,
} from '../workflow-dao.ts'

export type WorkflowFixture = {
  dao: WorkflowDao
  seedUser(id: string): Promise<void>
  close(): Promise<void>
}

const T0 = '2026-01-01T00:00:00.000Z'
const T1 = '2026-01-02T00:00:00.000Z'
const T2 = '2026-01-03T00:00:00.000Z'

function definitionOf(name = 'Test'): WorkflowDefinition {
  const { pipeline, inputs, output } = createWorkflow(name)
  return { pipeline, inputs, output }
}

export function workflow(
  overrides: Partial<WorkflowRecord> = {},
): WorkflowRecord {
  return {
    id: 'wf-1',
    ownerId: 'ann',
    name: 'Resize',
    definition: definitionOf(),
    revision: 0,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  }
}

export function run(
  overrides: Partial<WorkflowRunRecord> = {},
): WorkflowRunRecord {
  return {
    id: 'run-1',
    workflowId: 'wf-1',
    ownerId: 'ann',
    definition: definitionOf(),
    canvasMode: RunCanvasMode.Workflow,
    state: RunState.Running,
    createdAt: T0,
    finishedAt: null,
    ...overrides,
  }
}

async function prepare(
  create: () => Promise<WorkflowFixture>,
): Promise<WorkflowFixture> {
  const fixture = await create()
  await fixture.seedUser('ann')
  await fixture.seedUser('bob')
  return fixture
}

export function workflowDaoContract(
  implementation: string,
  create: () => Promise<WorkflowFixture>,
): void {
  describe(`WorkflowDao contract: ${implementation}`, () => {
    it('stores a Workflow and finds it by id', async () => {
      const { dao, close } = await prepare(create)
      const saved = workflow()
      await dao.insert(saved)
      expect(await dao.findById('wf-1')).toEqual(saved)
      expect(await dao.findById('missing')).toBeNull()
      await close()
    })

    it('lists a User’s Workflows, most recently changed first', async () => {
      const { dao, close } = await prepare(create)
      await dao.insert(workflow({ id: 'old', updatedAt: T0 }))
      await dao.insert(workflow({ id: 'new', updatedAt: T2 }))
      await dao.insert(workflow({ id: 'mid', updatedAt: T1 }))
      await dao.insert(workflow({ id: 'bobs', ownerId: 'bob' }))
      const ids = (await dao.listByOwner('ann')).map(({ id }) => id)
      expect(ids).toEqual(['new', 'mid', 'old'])
      await close()
    })

    it('saves a new name and definition and raises the revision', async () => {
      const { dao, close } = await prepare(create)
      await dao.insert(workflow())
      const base = definitionOf()
      const definition: WorkflowDefinition = {
        ...base,
        pipeline: {
          ...base.pipeline,
          steps: [...base.pipeline.steps, createSharpStep('flip')],
        },
        inputs: ['src-1'],
      }
      const updated = await dao.update(
        'wf-1',
        0,
        { name: 'Flip', definition },
        T1,
      )
      expect(updated).toMatchObject({
        name: 'Flip',
        revision: 1,
        updatedAt: T1,
        createdAt: T0,
      })
      expect(updated.definition).toEqual(definition)
      expect(await dao.findById('wf-1')).toEqual(updated)
      await close()
    })

    it('refuses to save over a newer revision, and says when it is gone', async () => {
      const { dao, close } = await prepare(create)
      await dao.insert(workflow())
      await dao.update('wf-1', 0, { name: 'A', definition: definitionOf() }, T1)
      await expect(
        dao.update('wf-1', 0, { name: 'B', definition: definitionOf() }, T2),
      ).rejects.toBeInstanceOf(ConflictError)
      await expect(
        dao.update('missing', 0, { name: 'B', definition: definitionOf() }, T2),
      ).rejects.toBeInstanceOf(NotFoundError)
      expect((await dao.findById('wf-1'))?.name).toBe('A')
      await close()
    })

    it('stores runs with their own copy of the definition and the canvas mode', async () => {
      const { dao, close } = await prepare(create)
      await dao.insert(workflow())
      const started = run()
      await dao.insertRun(started)
      await dao.update(
        'wf-1',
        0,
        { name: 'Changed', definition: { ...definitionOf(), inputs: ['x'] } },
        T1,
      )
      expect(await dao.findRun('run-1')).toEqual(started)
      expect(await dao.findRun('missing')).toBeNull()
      await dao.insertRun(
        run({ id: 'run-2', canvasMode: RunCanvasMode.FirstImage }),
      )
      expect((await dao.findRun('run-2'))?.canvasMode).toBe(
        RunCanvasMode.FirstImage,
      )
      await close()
    })

    it('lists runs newest first, for one Workflow or all', async () => {
      const { dao, close } = await prepare(create)
      await dao.insert(workflow({ id: 'wf-1' }))
      await dao.insert(workflow({ id: 'wf-2' }))
      await dao.insertRun(run({ id: 'a', workflowId: 'wf-1', createdAt: T0 }))
      await dao.insertRun(run({ id: 'b', workflowId: 'wf-2', createdAt: T1 }))
      await dao.insertRun(run({ id: 'c', workflowId: 'wf-1', createdAt: T2 }))
      await dao.insertRun(run({ id: 'bobs', ownerId: 'bob', workflowId: null }))
      expect((await dao.listRuns('ann')).map(({ id }) => id)).toEqual([
        'c',
        'b',
        'a',
      ])
      expect((await dao.listRuns('ann', 'wf-1')).map(({ id }) => id)).toEqual([
        'c',
        'a',
      ])
      await close()
    })

    it('records how a run ended', async () => {
      const { dao, close } = await prepare(create)
      await dao.insert(workflow())
      await dao.insertRun(run())
      await dao.updateRunState('run-1', RunState.Done, T1)
      expect(await dao.findRun('run-1')).toMatchObject({
        state: RunState.Done,
        finishedAt: T1,
      })
      await close()
    })

    it('deletes a run that never started', async () => {
      const { dao, close } = await prepare(create)
      await dao.insert(workflow())
      await dao.insertRun(run())
      await dao.deleteRun('run-1')
      expect(await dao.findRun('run-1')).toBeNull()
      await close()
    })

    it('keeps a run after its Workflow is deleted', async () => {
      const { dao, close } = await prepare(create)
      await dao.insert(workflow())
      await dao.insertRun(run())
      await dao.delete('wf-1')
      expect(await dao.findById('wf-1')).toBeNull()
      expect(await dao.findRun('run-1')).toMatchObject({ workflowId: null })
      await close()
    })
  })
}
