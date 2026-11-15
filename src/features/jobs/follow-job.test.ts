import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { followJob } from '@/features/jobs/follow-job'
import { getJobs } from '@/features/jobs/job-functions'
import { JobKind, JobState } from '@/server/jobs/job-types'
import type { JobView } from '@/server/services/job-service'

vi.mock('@/features/jobs/job-functions', () => ({ getJobs: vi.fn() }))

function job(state: JobState, progress: number): JobView {
  return {
    id: 'j1',
    kind: JobKind.Preview,
    state,
    progress,
    result: null,
    error: null,
    documentId: 'd1',
    workflowRunId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
  }
}

describe('followJob', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.resetAllMocks()
  })

  it('reports each change and returns the job that ended', async () => {
    vi.mocked(getJobs)
      .mockResolvedValueOnce([job(JobState.Waiting, 0)])
      .mockResolvedValueOnce([job(JobState.Running, 0.5)])
      .mockResolvedValueOnce([job(JobState.Running, 0.5)])
      .mockResolvedValueOnce([job(JobState.Done, 1)])
    const seen: string[] = []
    const promise = followJob('j1', new AbortController().signal, (update) => {
      seen.push(`${update.state}:${update.progress}`)
    })
    await vi.runAllTimersAsync()
    expect((await promise)?.state).toBe(JobState.Done)
    expect(seen).toEqual(['waiting:0', 'running:0.5', 'done:1'])
  })

  it('stops quietly when aborted', async () => {
    vi.mocked(getJobs).mockResolvedValue([job(JobState.Running, 0.1)])
    const controller = new AbortController()
    const promise = followJob('j1', controller.signal)
    await vi.advanceTimersByTimeAsync(10)
    controller.abort()
    await vi.runAllTimersAsync()
    expect(await promise).toBeUndefined()
  })
})
