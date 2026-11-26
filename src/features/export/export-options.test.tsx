import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getExportFormats } from '@/features/export/export-functions'
import { ExportFormat } from '@/features/export/export-settings'
import { ExportOptions } from '@/features/export/export-options'
import { createSharpStep } from '@/features/pipeline/pipeline'
import { followJob } from '@/features/jobs/follow-job'
import { requestExport } from '@/features/render/render-functions'
import { JobKind, JobState } from '@/server/jobs/job-types'
import type { JobView } from '@/server/services/job-service'
import { useLibraryStore } from '@/store/library-store'
import { usePipelineStore } from '@/store/pipeline-store'
import { PreviewStatus } from '@/features/documents/document-render'
import {
  DOCUMENT_ID,
  documentView,
  loadDocumentIntoEditor,
} from '@/test/document-fixtures'
import { resetStores } from '@/store/reset-stores'

vi.mock('@/features/export/export-functions', () => ({
  getExportFormats: vi.fn(),
}))
vi.mock('@/features/render/render-functions', () => ({
  requestExport: vi.fn(),
}))
vi.mock('@/features/jobs/follow-job', () => ({ followJob: vi.fn() }))

function job(state: JobState, resultId?: string, error?: string): JobView {
  return {
    id: 'export-job',
    kind: JobKind.Export,
    state,
    progress: 1,
    result: resultId ? { kind: JobKind.Export, resultId } : null,
    error: error ?? null,
    documentId: DOCUMENT_ID,
    workflowRunId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
  }
}

describe('ExportOptions', () => {
  beforeEach(() => {
    resetStores()
    vi.mocked(getExportFormats).mockResolvedValue([
      ExportFormat.Original,
      ExportFormat.Webp,
    ])
    loadDocumentIntoEditor(documentView())
    usePipelineStore.getState().setPreview(DOCUMENT_ID, {
      status: PreviewStatus.Ready,
      pendingStepIds: [],
      waitingLayerIds: [],
      problems: [],
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('queues the export with the chosen width, then downloads the finished result', async () => {
    vi.mocked(requestExport).mockResolvedValue(job(JobState.Waiting))
    vi.mocked(followJob).mockResolvedValue(job(JobState.Done, 'result-9'))
    const clicked: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
      function record(this: HTMLAnchorElement) {
        clicked.push(this.getAttribute('href') ?? '')
      },
    )
    const user = userEvent.setup()
    render(<ExportOptions documentId={DOCUMENT_ID} />)

    await user.type(screen.getByLabelText('Width (pixels)'), '640')
    await user.click(screen.getByRole('button', { name: 'Export' }))

    await waitFor(() => {
      expect(clicked).toEqual(['/api/results/result-9'])
    })
    expect(requestExport).toHaveBeenCalledWith({
      data: {
        documentId: DOCUMENT_ID,
        settings: expect.objectContaining({ format: ExportFormat.Original }),
        width: 640,
      },
    })
    expect(useLibraryStore.getState().resultsVersion).toBe(1)
    expect(screen.getByRole('status')).toHaveTextContent('downloading')
  })

  it('shows why the export failed and downloads nothing', async () => {
    vi.mocked(requestExport).mockResolvedValue(job(JobState.Waiting))
    vi.mocked(followJob).mockResolvedValue(
      job(JobState.Failed, undefined, 'The image is too large.'),
    )
    const user = userEvent.setup()
    render(<ExportOptions documentId={DOCUMENT_ID} />)

    await user.click(screen.getByRole('button', { name: 'Export' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The image is too large.',
    )
  })

  it('refuses a width that is not a whole number without asking the server', async () => {
    const user = userEvent.setup()
    render(<ExportOptions documentId={DOCUMENT_ID} />)

    await user.type(screen.getByLabelText('Width (pixels)'), '12.5')
    await user.click(screen.getByRole('button', { name: 'Export' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('whole number')
    expect(requestExport).not.toHaveBeenCalled()
  })

  it('cannot export while an AI step has not run', () => {
    loadDocumentIntoEditor(documentView([createSharpStep('blur')]))
    usePipelineStore.getState().setPreview(DOCUMENT_ID, {
      status: PreviewStatus.Ready,
      pendingStepIds: ['s1'],
      waitingLayerIds: [],
      problems: [],
    })
    render(<ExportOptions documentId={DOCUMENT_ID} />)

    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Run the AI steps')
  })
})
