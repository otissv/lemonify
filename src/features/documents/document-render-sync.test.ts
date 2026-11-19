import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  refreshPreview,
  refreshThumbnails,
  runPendingAiSteps,
} from '@/features/documents/document-render-sync'
import { followJob } from '@/features/jobs/follow-job'
import {
  requestAiStep,
  requestPreview,
  requestThumbnails,
} from '@/features/render/render-functions'
import { JobKind, JobState } from '@/server/jobs/job-types'
import type { JobView } from '@/server/services/job-service'
import { useLibraryStore } from '@/store/library-store'
import { usePipelineStore } from '@/store/pipeline-store'
import { PreviewStatus } from '@/features/documents/document-render'
import { resetStores } from '@/store/reset-stores'
import { StepViewPart } from '@/features/overlay/step-view'
import { useUiStore } from '@/store/ui-store'
import { createSharpStep } from '@/features/pipeline/pipeline'
import {
  DOCUMENT_ID,
  documentView,
  loadDocumentIntoEditor,
} from '@/test/document-fixtures'

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
    resetStores()
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
        width: 4000,
        height: 3000,
        pendingStepIds: ['s2'],
        problems: [{ stepId: 's3', message: 'Needs width.' }],
      }),
    )
    await refreshPreview('d1', SIGNAL)
    expect(usePipelineStore.getState().previews.d1).toEqual({
      status: PreviewStatus.Ready,
      key: 'k1',
      size: { width: 4000, height: 3000 },
      view: undefined,
      pendingStepIds: ['s2'],
      problems: [{ stepId: 's3', message: 'Needs width.' }],
    })
  })

  describe('with a tool that draws on the picture', () => {
    const extract = createSharpStep('extract')
    const blur = createSharpStep('blur')

    function ready(width: number, height: number) {
      return job(JobKind.Preview, JobState.Done, {
        kind: JobKind.Preview,
        key: 'k',
        width,
        height,
        pendingStepIds: [],
        problems: [],
      })
    }

    beforeEach(() => {
      loadDocumentIntoEditor(documentView([blur, extract]))
    })

    it('asks for the picture before the selected step and remembers which it is', async () => {
      useUiStore.getState().selectStep(DOCUMENT_ID, extract.id)
      vi.mocked(followJob).mockResolvedValue(ready(500, 400))

      await refreshPreview(DOCUMENT_ID, SIGNAL)

      expect(requestPreview).toHaveBeenCalledWith({
        data: { documentId: DOCUMENT_ID, beforeStepId: extract.id },
      })
      expect(usePipelineStore.getState().previews[DOCUMENT_ID]).toMatchObject({
        size: { width: 500, height: 400 },
        view: { stepId: extract.id, part: 'tool' },
      })
    })

    it('asks for the picture the step leaves when its result is chosen', async () => {
      useUiStore.getState().selectStep(DOCUMENT_ID, extract.id)
      useUiStore.getState().setStepView(DOCUMENT_ID, StepViewPart.Output)
      vi.mocked(followJob).mockResolvedValue(ready(300, 200))

      await refreshPreview(DOCUMENT_ID, SIGNAL)

      expect(requestPreview).toHaveBeenCalledWith({
        data: { documentId: DOCUMENT_ID, throughStepId: extract.id },
      })
      expect(usePipelineStore.getState().previews[DOCUMENT_ID]).toMatchObject({
        size: { width: 300, height: 200 },
        view: { stepId: extract.id, part: 'output' },
      })
    })

    it('asks for the whole document when the selected step has no such tool, or none is selected', async () => {
      vi.mocked(followJob).mockResolvedValue(ready(500, 400))

      await refreshPreview(DOCUMENT_ID, SIGNAL)
      useUiStore.getState().selectStep(DOCUMENT_ID, blur.id)
      await refreshPreview(DOCUMENT_ID, SIGNAL)

      for (const [call] of vi.mocked(requestPreview).mock.calls) {
        expect(call.data.beforeStepId).toBeUndefined()
      }
      expect(
        usePipelineStore.getState().previews[DOCUMENT_ID]?.view,
      ).toBeUndefined()
    })

    it('keeps the picture, its size and which it is while the next one is made and if it fails', async () => {
      useUiStore.getState().selectStep(DOCUMENT_ID, extract.id)
      vi.mocked(followJob).mockResolvedValueOnce(ready(500, 400))
      await refreshPreview(DOCUMENT_ID, SIGNAL)

      vi.mocked(followJob).mockResolvedValueOnce(
        job(JobKind.Preview, JobState.Failed, null, 'Broken.'),
      )
      await refreshPreview(DOCUMENT_ID, SIGNAL)

      expect(usePipelineStore.getState().previews[DOCUMENT_ID]).toMatchObject({
        status: PreviewStatus.Failed,
        key: 'k',
        size: { width: 500, height: 400 },
        view: { stepId: extract.id, part: 'tool' },
      })
    })
  })

  it('keeps the last picture and says why when the preview fails', async () => {
    usePipelineStore.getState().setPreview('d1', {
      status: PreviewStatus.Ready,
      key: 'old',
      pendingStepIds: [],
      problems: [],
    })
    vi.mocked(followJob).mockResolvedValue(
      job(JobKind.Preview, JobState.Failed, null, 'The image is damaged.'),
    )
    await refreshPreview('d1', SIGNAL)
    expect(usePipelineStore.getState().previews.d1).toMatchObject({
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
    expect(usePipelineStore.getState().previews.d1?.status).toBe(
      PreviewStatus.Rendering,
    )
  })
})

describe('refreshThumbnails', () => {
  beforeEach(() => {
    resetStores()
    vi.resetAllMocks()
  })

  it('asks for the picture before each step a tool draws on, and keeps both kinds', async () => {
    const extract = createSharpStep('extract')
    loadDocumentIntoEditor(documentView([createSharpStep('blur'), extract]))
    vi.mocked(requestThumbnails).mockResolvedValue(
      job(JobKind.Thumbnail, JobState.Waiting),
    )
    const thumbnails = [
      { stepId: extract.id, key: 'after' },
      { stepId: extract.id, key: 'before', before: true as const },
    ]
    vi.mocked(followJob).mockResolvedValue(
      job(JobKind.Thumbnail, JobState.Done, {
        kind: JobKind.Thumbnail,
        thumbnails,
      }),
    )

    await refreshThumbnails(DOCUMENT_ID, SIGNAL)

    expect(requestThumbnails).toHaveBeenCalledWith({
      data: { documentId: DOCUMENT_ID, beforeStepIds: [extract.id] },
    })
    expect(usePipelineStore.getState().thumbnails[DOCUMENT_ID]).toEqual(
      thumbnails,
    )
  })
})

describe('runPendingAiSteps', () => {
  beforeEach(() => {
    resetStores()
    vi.resetAllMocks()
  })

  it('runs each pending step in turn, renewing the picture between them', async () => {
    usePipelineStore.getState().setPreview('d1', {
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
          width: 10,
          height: 10,
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
    expect(usePipelineStore.getState().aiRuns.d1).toBeUndefined()
    expect(useLibraryStore.getState().resultsVersion).toBe(2)
  })

  it('stops and shows the reason when a step fails', async () => {
    usePipelineStore.getState().setPreview('d1', {
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
    expect(usePipelineStore.getState().aiRuns.d1).toMatchObject({
      stepId: 'a',
      state: JobState.Failed,
      error: 'No GPU.',
    })
  })
})
