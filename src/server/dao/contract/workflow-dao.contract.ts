import { EMPTY_SNAPSHOT } from '@/features/workflows/used-snapshot'
import { describe, expect, it } from 'vitest'

import type { WorkflowHistoryPatch } from '@/features/workflows/workflow-change'
import { CanvasSize, createWorkflow } from '@/features/workflows/workflow'
import type { WorkflowDefinition } from '@/features/workflows/workflow'

import { ConflictError, NotFoundError } from '../../errors.ts'
import { RunState } from '../workflow-dao.ts'
import type {
  RecordedWorkflowChange,
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
  const { pipeline, inputs, output, canvasSize } = createWorkflow(name)
  return { pipeline, inputs, output, canvasSize }
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
    historyCursor: 0,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  }
}

const PATCH: WorkflowHistoryPatch = {
  forward: { type: 'set-inputs', sourceIds: ['a'] },
  inverse: { type: 'set-inputs', sourceIds: [] },
}

function withInputs(inputs: string[]): WorkflowDefinition {
  return { ...definitionOf(), inputs }
}

function recorded(
  overrides: Partial<RecordedWorkflowChange> = {},
): RecordedWorkflowChange {
  return {
    id: 'wf-1',
    expectedRevision: 0,
    definition: withInputs(['a']),
    patch: PATCH,
    maxEntries: 100,
    now: T1,
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
    used: EMPTY_SNAPSHOT,
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

    it('starts with nothing to undo', async () => {
      const { dao, close } = await prepare(create)
      await dao.insert(workflow())
      expect((await dao.findById('wf-1'))?.historyCursor).toBe(0)
      expect(await dao.findEntry('wf-1', 0)).toBeNull()
      await close()
    })

    it('records a change: the definition, the entry at the cursor, a higher revision', async () => {
      const { dao, close } = await prepare(create)
      await dao.insert(workflow())
      const next = withInputs(['src-1'])
      const saved = await dao.applyChange(recorded({ definition: next }))
      expect(saved).toMatchObject({
        revision: 1,
        historyCursor: 1,
        updatedAt: T1,
        createdAt: T0,
        name: 'Resize',
      })
      expect(saved.definition).toEqual(next)
      expect(await dao.findById('wf-1')).toEqual(saved)
      expect(await dao.findEntry('wf-1', 0)).toEqual({
        workflowId: 'wf-1',
        position: 0,
        patch: PATCH,
        createdAt: T1,
      })
      await close()
    })

    it('drops the undone entries when a new change is made', async () => {
      const { dao, close } = await prepare(create)
      await dao.insert(workflow())
      await dao.applyChange(recorded())
      await dao.applyChange(recorded({ expectedRevision: 1 }))
      await dao.moveCursor({
        id: 'wf-1',
        expectedRevision: 2,
        definition: definitionOf(),
        cursor: 1,
        now: T2,
      })
      await dao.applyChange(recorded({ expectedRevision: 3 }))
      expect((await dao.findById('wf-1'))?.historyCursor).toBe(2)
      expect(await dao.findEntry('wf-1', 0)).not.toBeNull()
      expect(await dao.findEntry('wf-1', 1)).not.toBeNull()
      expect(await dao.findEntry('wf-1', 2)).toBeNull()
      await close()
    })

    it('keeps only the newest entries', async () => {
      const { dao, close } = await prepare(create)
      await dao.insert(workflow())
      for (let revision = 0; revision < 3; revision += 1) {
        await dao.applyChange(
          recorded({ expectedRevision: revision, maxEntries: 2 }),
        )
      }
      expect(await dao.findEntry('wf-1', 0)).toBeNull()
      expect(await dao.findEntry('wf-1', 1)).not.toBeNull()
      expect(await dao.findEntry('wf-1', 2)).not.toBeNull()
      await close()
    })

    it('moves the cursor with the definition an undo or redo made', async () => {
      const { dao, close } = await prepare(create)
      const original = definitionOf()
      await dao.insert(workflow({ definition: original }))
      await dao.applyChange(recorded({ definition: withInputs(['a']) }))
      const moved = await dao.moveCursor({
        id: 'wf-1',
        expectedRevision: 1,
        definition: original,
        cursor: 0,
        now: T2,
      })
      expect(moved).toMatchObject({
        revision: 2,
        historyCursor: 0,
        updatedAt: T2,
      })
      expect(moved.definition).toEqual(original)
      expect(await dao.findEntry('wf-1', 0)).not.toBeNull()
      await close()
    })

    it('refuses a change or a move over a newer revision, and says when it is gone', async () => {
      const { dao, close } = await prepare(create)
      await dao.insert(workflow())
      await dao.applyChange(recorded({ definition: withInputs(['a']) }))
      await expect(dao.applyChange(recorded())).rejects.toBeInstanceOf(
        ConflictError,
      )
      await expect(
        dao.moveCursor({
          id: 'wf-1',
          expectedRevision: 0,
          definition: definitionOf(),
          cursor: 0,
          now: T2,
        }),
      ).rejects.toBeInstanceOf(ConflictError)
      await expect(
        dao.applyChange(recorded({ id: 'missing' })),
      ).rejects.toBeInstanceOf(NotFoundError)
      expect((await dao.findById('wf-1'))?.historyCursor).toBe(1)
      await close()
    })

    it('renames without touching the definition, the revision or the history', async () => {
      const { dao, close } = await prepare(create)
      await dao.insert(workflow())
      await dao.applyChange(recorded())
      const renamed = await dao.rename('wf-1', 'Flip', T2)
      expect(renamed).toMatchObject({
        name: 'Flip',
        revision: 1,
        historyCursor: 1,
        updatedAt: T2,
      })
      await expect(dao.rename('missing', 'x', T2)).rejects.toBeInstanceOf(
        NotFoundError,
      )
      await close()
    })

    it('deletes the history with the Workflow', async () => {
      const { dao, close } = await prepare(create)
      await dao.insert(workflow())
      await dao.applyChange(recorded())
      await dao.delete('wf-1')
      expect(await dao.findEntry('wf-1', 0)).toBeNull()
      await close()
    })

    it('stores runs with their own copy of the definition, canvas size included', async () => {
      const { dao, close } = await prepare(create)
      await dao.insert(workflow())
      const started = run()
      await dao.insertRun(started)
      await dao.applyChange(recorded({ definition: withInputs(['x']) }))
      expect(await dao.findRun('run-1')).toEqual(started)
      expect(await dao.findRun('missing')).toBeNull()
      await dao.insertRun(
        run({
          id: 'run-2',
          definition: { ...definitionOf(), canvasSize: CanvasSize.Fixed },
        }),
      )
      expect((await dao.findRun('run-2'))?.definition.canvasSize).toBe(
        CanvasSize.Fixed,
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
