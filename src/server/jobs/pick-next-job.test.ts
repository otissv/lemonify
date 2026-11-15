import { describe, expect, it } from 'vitest'

import { WorkerPool } from '@/features/ai/ai-tools'

import { job } from '../dao/contract/job-dao.contract.ts'
import { JobKind } from './job-types.ts'
import type { JobRecord } from './job-types.ts'
import { pickBatchCompanions, pickNextJob } from './pick-next-job.ts'

const RULES = { slots: 4, groupSharePercent: 50 }
const NEVER: ReadonlyMap<string, number> = new Map()

function waitingJob(
  id: string,
  group: string,
  overrides: Partial<JobRecord> = {},
) {
  return job({ id, groupKey: group, documentId: group, ...overrides })
}

function running(counts: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(counts))
}

function aiJob(id: string, batchKey: string | undefined, createdAt: string) {
  return job({
    id,
    kind: JobKind.AiStep,
    pool: WorkerPool.Gpu,
    createdAt,
    payload: {
      kind: JobKind.RunItem,
      workflowRunId: 'run',
      sourceId: 's',
      segment: 0,
      batchKey,
    },
  })
}

describe('pickNextJob', () => {
  it('picks nothing when nothing waits', () => {
    expect(pickNextJob([], running({}), NEVER, RULES)).toBeUndefined()
  })

  it('takes the oldest Job of the best priority', () => {
    const jobs = [
      waitingJob('old-slow', 'a', {
        priority: 3,
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
      waitingJob('new-fast', 'b', {
        priority: 0,
        createdAt: '2026-01-01T00:00:05.000Z',
      }),
      waitingJob('older-fast', 'c', {
        priority: 0,
        createdAt: '2026-01-01T00:00:01.000Z',
      }),
    ]
    expect(pickNextJob(jobs, running({}), NEVER, RULES)?.id).toBe('older-fast')
  })

  it('serves a preview before workflow work that has waited longer, whatever each group runs', () => {
    const jobs = [
      waitingJob('run-item', 'run', {
        priority: 3,
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
      waitingJob('preview', 'doc', {
        priority: 0,
        createdAt: '2026-01-01T00:00:09.000Z',
      }),
    ]
    expect(
      pickNextJob(jobs, running({ doc: 3, run: 0 }), NEVER, RULES)?.id,
    ).toBe('preview')
  })

  it('alternates between two Documents instead of draining the first', () => {
    const jobs = [
      waitingJob('a1', 'a', { createdAt: '2026-01-01T00:00:00.000Z' }),
      waitingJob('a2', 'a', { createdAt: '2026-01-01T00:00:01.000Z' }),
      waitingJob('b1', 'b', { createdAt: '2026-01-01T00:00:02.000Z' }),
    ]
    expect(pickNextJob(jobs, running({ a: 1 }), NEVER, RULES)?.id).toBe('b1')
    expect(pickNextJob(jobs, running({}), NEVER, RULES)?.id).toBe('a1')
  })

  it('takes turns between groups even when one has the older queue', () => {
    const jobs = [
      waitingJob('a2', 'a', { createdAt: '2026-01-01T00:00:00.000Z' }),
      waitingJob('b1', 'b', { createdAt: '2026-01-01T00:00:09.000Z' }),
    ]
    const aServedLast = new Map([
      ['a', 7],
      ['b', 3],
    ])
    expect(pickNextJob(jobs, running({}), aServedLast, RULES)?.id).toBe('b1')
    const bServedLast = new Map([
      ['a', 3],
      ['b', 7],
    ])
    expect(pickNextJob(jobs, running({}), bServedLast, RULES)?.id).toBe('a2')
  })

  it('stops a group at its share of the slots while another group waits', () => {
    const jobs = [
      waitingJob('a3', 'a', { createdAt: '2026-01-01T00:00:00.000Z' }),
      waitingJob('b1', 'b', { createdAt: '2026-01-01T00:00:09.000Z' }),
    ]
    expect(pickNextJob(jobs, running({ a: 2, b: 2 }), NEVER, RULES)?.id).toBe(
      'a3',
    )
    expect(pickNextJob(jobs, running({ a: 2 }), NEVER, RULES)?.id).toBe('b1')
  })

  it('lets a lone group use every slot', () => {
    const jobs = [waitingJob('a3', 'a')]
    expect(pickNextJob(jobs, running({ a: 3 }), NEVER, RULES)?.id).toBe('a3')
  })

  it('never lets the share put lower-priority work ahead', () => {
    const jobs = [
      waitingJob('preview-a', 'a', { priority: 0 }),
      waitingJob('run-b', 'b', { priority: 3 }),
    ]
    expect(pickNextJob(jobs, running({ a: 2 }), NEVER, RULES)?.id).toBe(
      'preview-a',
    )
  })

  it('gives every group at least one slot when the share rounds to zero', () => {
    const jobs = [waitingJob('a1', 'a'), waitingJob('b1', 'b')]
    const tiny = { slots: 1, groupSharePercent: 10 }
    expect(pickNextJob(jobs, running({ a: 1 }), NEVER, tiny)?.id).toBe('b1')
  })
})

describe('pickBatchCompanions', () => {
  it('takes waiting Jobs with the same batch key, oldest first, up to the cap', () => {
    const primary = aiJob('p', 'm:4', '2026-01-01T00:00:00.000Z')
    const waiting = [
      aiJob('c', 'm:4', '2026-01-01T00:00:03.000Z'),
      aiJob('other', 'm:2', '2026-01-01T00:00:01.000Z'),
      aiJob('a', 'm:4', '2026-01-01T00:00:01.000Z'),
      aiJob('b', 'm:4', '2026-01-01T00:00:02.000Z'),
    ]
    expect(
      pickBatchCompanions(primary, waiting, 3).map(({ id }) => id),
    ).toEqual(['a', 'b'])
  })

  it('never includes the primary Job', () => {
    const primary = aiJob('p', 'k', '2026-01-01T00:00:00.000Z')
    expect(pickBatchCompanions(primary, [primary], 8)).toEqual([])
  })

  it('does not batch a Job that has no key, or when the cap is one', () => {
    const alone = aiJob('p', undefined, '2026-01-01T00:00:00.000Z')
    const other = aiJob('q', undefined, '2026-01-01T00:00:01.000Z')
    expect(pickBatchCompanions(alone, [other], 8)).toEqual([])
    const keyed = aiJob('k', 'x', '2026-01-01T00:00:00.000Z')
    expect(pickBatchCompanions(keyed, [aiJob('l', 'x', 'z')], 1)).toEqual([])
  })

  it('keeps pools apart', () => {
    const primary = aiJob('p', 'k', '2026-01-01T00:00:00.000Z')
    const cpu = {
      ...aiJob('q', 'k', '2026-01-01T00:00:01.000Z'),
      pool: WorkerPool.Cpu,
    }
    expect(pickBatchCompanions(primary, [cpu], 8)).toEqual([])
  })
})
