import { beforeEach, describe, expect, it, vi } from 'vitest'

import { followJob } from '@/features/jobs/follow-job'
import { addStepAfter } from '@/features/pipeline/pipeline-actions'
import { requestPreview } from '@/features/render/render-functions'
import { NOT_MEASURED, addTool } from '@/features/tools/add-tool'
import { JobKind, JobState } from '@/server/jobs/job-types'
import type { JobView } from '@/server/services/job-service'
import { resetStores } from '@/store/reset-stores'
import { useUiStore } from '@/store/ui-store'
import {
  DOCUMENT_ID,
  documentView,
  loadDocumentIntoEditor,
} from '@/test/document-fixtures'

vi.mock('@/features/pipeline/pipeline-actions', () => ({
  addStepAfter: vi.fn(),
}))
vi.mock('@/features/render/render-functions', () => ({
  requestPreview: vi.fn(),
}))
vi.mock('@/features/jobs/follow-job', () => ({ followJob: vi.fn() }))

function previewJob(
  state: JobState,
  size?: { width: number; height: number },
): JobView {
  return {
    id: 'job-1',
    kind: JobKind.Preview,
    state,
    progress: 1,
    error: null,
    documentId: DOCUMENT_ID,
    workflowRunId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    result:
      size === undefined
        ? null
        : {
            kind: JobKind.Preview,
            key: 'picture',
            ...size,
            pendingStepIds: [],
            problems: [],
          },
  }
}

beforeEach(() => {
  resetStores()
  vi.resetAllMocks()
})

describe('addTool', () => {
  it('adds a Sharp step with the values the website fills in', () => {
    expect(
      addTool('doc', { kind: 'sharp', value: 'scale' }, []),
    ).toBeUndefined()

    expect(addStepAfter).toHaveBeenCalledWith(
      'doc',
      expect.objectContaining({ op: 'scale', options: { percent: 100 } }),
      undefined,
    )
    expect(requestPreview).not.toHaveBeenCalled()
  })

  it("gives a step that needs another image the document's own image", () => {
    const view = documentView()
    loadDocumentIntoEditor(view)

    addTool(DOCUMENT_ID, { kind: 'sharp', value: 'boolean' }, [])

    expect(addStepAfter).toHaveBeenCalledWith(
      DOCUMENT_ID,
      expect.objectContaining({
        op: 'boolean',
        options: { operator: 'and', operand: view.source.id },
      }),
      undefined,
    )
  })

  it('starts a resize at the size of the picture it is added after', async () => {
    loadDocumentIntoEditor(documentView())
    useUiStore.getState().selectStep(DOCUMENT_ID, 'layer-1')
    vi.mocked(requestPreview).mockResolvedValue(previewJob(JobState.Waiting))
    vi.mocked(followJob).mockResolvedValue(
      previewJob(JobState.Done, { width: 800, height: 600 }),
    )

    addTool(DOCUMENT_ID, { kind: 'sharp', value: 'resize' }, [])

    await vi.waitFor(() => {
      expect(addStepAfter).toHaveBeenCalledWith(
        DOCUMENT_ID,
        expect.objectContaining({
          op: 'resize',
          options: { width: 800, height: 600 },
        }),
        'layer-1',
      )
    })
    expect(requestPreview).toHaveBeenCalledWith({
      data: { documentId: DOCUMENT_ID, throughStepId: 'layer-1' },
    })
  })

  it('measures the whole document when the resize goes at the end', async () => {
    loadDocumentIntoEditor(documentView())
    vi.mocked(requestPreview).mockResolvedValue(previewJob(JobState.Waiting))
    vi.mocked(followJob).mockResolvedValue(
      previewJob(JobState.Done, { width: 320, height: 200 }),
    )

    addTool(DOCUMENT_ID, { kind: 'sharp', value: 'resize' }, [])

    await vi.waitFor(() => {
      expect(addStepAfter).toHaveBeenCalled()
    })
    expect(requestPreview).toHaveBeenCalledWith({
      data: { documentId: DOCUMENT_ID },
    })
  })

  it('adds a resize with its size left to fill when the picture cannot be measured', async () => {
    loadDocumentIntoEditor(documentView())
    vi.mocked(requestPreview).mockRejectedValue(new Error('offline'))

    addTool(DOCUMENT_ID, { kind: 'sharp', value: 'resize' }, [])

    await vi.waitFor(() => {
      expect(addStepAfter).toHaveBeenCalledWith(
        DOCUMENT_ID,
        expect.objectContaining({ op: 'resize', options: {} }),
        undefined,
      )
    })
    expect(useUiStore.getState().liveNotice).toBe(NOT_MEASURED)
  })
})
