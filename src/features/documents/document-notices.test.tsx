import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  changeDocument,
  getDocument,
  listDocuments,
  redoDocument,
  undoDocument,
} from '@/features/documents/document-functions'
import { followJob } from '@/features/jobs/follow-job'
import { createSharpStep } from '@/features/pipeline/pipeline'
import {
  requestPreview,
  requestThumbnails,
} from '@/features/render/render-functions'
import { listWorkflows } from '@/features/workflows/workflow-functions'
import { INITIAL_APP_STATE, useAppStore } from '@/store/app-store'
import { DOCUMENT_ID, documentView } from '@/test/document-fixtures'
import { renderApp } from '@/test/render-app'

vi.mock('@/features/documents/document-functions', () => ({
  listDocuments: vi.fn(),
  getDocument: vi.fn(),
  createDocument: vi.fn(),
  deleteDocument: vi.fn(),
  changeDocument: vi.fn(),
  undoDocument: vi.fn(),
  redoDocument: vi.fn(),
}))
vi.mock('@/features/workflows/workflow-functions', () => ({
  listWorkflows: vi.fn(),
}))
vi.mock('@/features/render/render-functions', () => ({
  requestPreview: vi.fn(),
  requestThumbnails: vi.fn(),
  requestAiStep: vi.fn(),
}))
vi.mock('@/features/jobs/follow-job', () => ({ followJob: vi.fn() }))
vi.mock('@/features/jobs/job-functions', () => ({ cancelJob: vi.fn() }))

const BLUR = createSharpStep('blur')

describe('DocumentNotices', () => {
  beforeEach(() => {
    useAppStore.setState(INITIAL_APP_STATE)
    vi.mocked(listWorkflows).mockResolvedValue([])
    vi.mocked(listDocuments).mockResolvedValue([])
    vi.mocked(requestPreview).mockResolvedValue({ id: 'p' } as never)
    vi.mocked(requestThumbnails).mockResolvedValue({ id: 't' } as never)
    vi.mocked(followJob).mockReturnValue(new Promise(() => undefined))
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('undoes and redoes from the keyboard, but not while typing in a field', async () => {
    vi.mocked(getDocument).mockResolvedValue({
      ...documentView([BLUR]),
      revision: 1,
      canUndo: true,
    })
    vi.mocked(undoDocument).mockResolvedValue({
      ...documentView(),
      revision: 2,
      canRedo: true,
    })
    vi.mocked(redoDocument).mockResolvedValue({
      ...documentView([BLUR]),
      revision: 3,
      canUndo: true,
    })
    const user = userEvent.setup()
    await renderApp(`/documents/${DOCUMENT_ID}`)
    await screen.findByRole('searchbox', { name: 'Search tools' })

    await user.keyboard('{Control>}z{/Control}')
    await waitFor(() => {
      expect(undoDocument).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(
        useAppStore.getState().documents[DOCUMENT_ID]?.confirmed.canRedo,
      ).toBe(true)
    })
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}')
    await waitFor(() => {
      expect(redoDocument).toHaveBeenCalledTimes(1)
    })

    await user.click(screen.getByRole('searchbox', { name: 'Search tools' }))
    await user.keyboard('{Control>}z{/Control}')
    expect(undoDocument).toHaveBeenCalledTimes(1)
    expect(changeDocument).not.toHaveBeenCalled()
  })

  it('says when the server could not save a change, and shows the server’s own state again', async () => {
    vi.mocked(getDocument).mockResolvedValue(documentView())
    vi.mocked(changeDocument).mockRejectedValue(
      new Error('This image was changed somewhere else.'),
    )
    const user = userEvent.setup()
    await renderApp(`/documents/${DOCUMENT_ID}`)
    await user.click(await screen.findByRole('button', { name: 'Filters' }))
    await user.click(await screen.findByRole('button', { name: 'Add Blur' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This image was changed somewhere else.',
    )
    expect(
      useAppStore.getState().documents[DOCUMENT_ID]?.confirmed.pipeline.steps,
    ).toEqual(documentView().pipeline.steps)
  })
})
