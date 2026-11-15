import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  refreshPreview,
  runPendingAiSteps,
} from '@/features/documents/document-render-sync'
import { followJob } from '@/features/jobs/follow-job'
import {
  requestAiStep,
  requestPreview,
} from '@/features/render/render-functions'
import { JobKind, JobState } from '@/server/jobs/job-types'
import type { JobView } from '@/server/services/job-service'
import {
  INITIAL_APP_STATE,
  PreviewStatus,
  useAppStore,
} from '@/store/app-store'

vi.mock('@/features/render/render-functions', () => ({
  requestPreview: vi.fn(),
  requestThumbnails: vi.fn(),
  requestAiStep: vi.fn(),
}))
vi.mock('@/features/jobs/follow-job', () => ({ followJob: vi.fn() }))
vi.mock('@/features/jobs/job-functions', () => ({ cancelJob: vi.fn() }))

function job(
  kind: JobKind,
  state: JobState,
  result: JobView['result'] = null,
  error: string | null = null,
): JobView {
  return {
    id: `${kind}-job`,
    kind,
    state,
    progress: 1,
    result,
    error,
    documentId: 'd1',
    workflowRunId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
  }
}

const SIGNAL = new AbortController().signal

describe('refreshPreview', () => {
  beforeEach(() => {
    useAppStore.setState(INITIAL_APP_STATE)
    vi.resetAllMocks()
    vi.mocked(requestPreview).mockResolvedValue(
      job(JobKind.Preview, JobState.Waiting),
    )
  })

  it('shows the picture a finished preview made, and the steps still waiting for the AI', async () => {
    vi.mocked(followJob).mockResolvedValue(
      job(JobKind.Preview, JobState.Done, {
        kind: JobKind.Preview,
        key: 'k1',
        pendingStepIds: ['s2'],
        problems: [{ stepId: 's3', message: 'Needs width.' }],
      }),
    )
    await refreshPreview('d1', SIGNAL)
    expect(useAppStore.getState().previews.d1).toEqual({
      status: PreviewStatus.Ready,
      key: 'k1',
      pendingStepIds: ['s2'],
      problems: [{ stepId: 's3', message: 'Needs width.' }],
    })
  })

  it('keeps the last picture and says why when the preview fails', async () => {
    useAppStore.getState().setPreview('d1', {
      status: PreviewStatus.Ready,
      key: 'old',
      pendingStepIds: [],
      problems: [],
    })
    vi.mocked(followJob).mockResolvedValue(
      job(JobKind.Preview, JobState.Failed, null, 'The image is damaged.'),
    )
    await refreshPreview('d1', SIGNAL)
    expect(useAppStore.getState().previews.d1).toMatchObject({
      status: PreviewStatus.Failed,
      key: 'old',
      error: 'The image is damaged.',
    })
  })

  it('ignores a preview a newer request replaced', async () => {
    vi.mocked(followJob).mockResolvedValue(
      job(JobKind.Preview, JobState.Cancelled),
    )
    await refreshPreview('d1', SIGNAL)
    expect(useAppStore.getState().previews.d1?.status).toBe(
      PreviewStatus.Rendering,
    )
  })
})

describe('runPendingAiSteps', () => {
  beforeEach(() => {
    useAppStore.setState(INITIAL_APP_STATE)
    vi.resetAllMocks()
  })

  it('runs each pending step in turn, renewing the picture between them', async () => {
    useAppStore.getState().setPreview('d1', {
      status: PreviewStatus.Ready,
      key: 'k',
      pendingStepIds: ['a', 'b'],
      problems: [],
    })
    vi.mocked(requestAiStep).mockImplementation(({ data }) =>
      Promise.resolve(job(JobKind.AiStep, JobState.Waiting, null, data.stepId)),
    )
    vi.mocked(requestPreview).mockResolvedValue(
      job(JobKind.Preview, JobState.Waiting),
    )
    let previews = 0
    vi.mocked(followJob).mockImplementation((id) => {
      if (id === `${JobKind.AiStep}-job`) {
        return Promise.resolve(
          job(JobKind.AiStep, JobState.Done, {
            kind: JobKind.AiStep,
            resultId: 'r',
          }),
        )
      }
      previews += 1
      return Promise.resolve(
        job(JobKind.Preview, JobState.Done, {
          kind: JobKind.Preview,
          key: `k${previews}`,
          pendingStepIds: previews === 1 ? ['b'] : [],
          problems: [],
        }),
      )
    })
    await runPendingAiSteps('d1')
    const ran = vi
      .mocked(requestAiStep)
      .mock.calls.map(([{ data }]) => data.stepId)
    expect(ran).toEqual(['a', 'b'])
    expect(useAppStore.getState().aiRuns.d1).toBeUndefined()
    expect(useAppStore.getState().resultsVersion).toBe(2)
  })

  it('stops and shows the reason when a step fails', async () => {
    useAppStore.getState().setPreview('d1', {
      status: PreviewStatus.Ready,
      key: 'k',
      pendingStepIds: ['a', 'b'],
      problems: [],
    })
    vi.mocked(requestAiStep).mockResolvedValue(
      job(JobKind.AiStep, JobState.Waiting),
    )
    vi.mocked(followJob).mockResolvedValue(
      job(JobKind.AiStep, JobState.Failed, null, 'No GPU.'),
    )
    await runPendingAiSteps('d1')
    expect(requestAiStep).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().aiRuns.d1).toMatchObject({
      stepId: 'a',
      state: JobState.Failed,
      error: 'No GPU.',
    })
  })
})
