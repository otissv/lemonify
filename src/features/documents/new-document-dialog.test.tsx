import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createBlankDocument,
  getDocument,
  listDocuments,
} from '@/features/documents/document-functions'
import { followJob } from '@/features/jobs/follow-job'
import {
  requestPreview,
  requestThumbnails,
} from '@/features/render/render-functions'
import { listWorkflows } from '@/features/workflows/workflow-functions'
import { INITIAL_APP_STATE, useAppStore } from '@/store/app-store'
import { DOCUMENT_ID, documentView, previewJob } from '@/test/document-fixtures'
import { renderApp } from '@/test/render-app'

vi.mock('@/features/documents/document-functions', () => ({
  listDocuments: vi.fn(),
  getDocument: vi.fn(),
  createDocument: vi.fn(),
  createBlankDocument: vi.fn(),
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

beforeEach(() => {
  useAppStore.setState(INITIAL_APP_STATE)
  vi.mocked(listWorkflows).mockResolvedValue([])
  vi.mocked(listDocuments).mockResolvedValue([])
  vi.mocked(getDocument).mockResolvedValue(documentView())
  vi.mocked(requestPreview).mockResolvedValue({ id: 'p' } as never)
  vi.mocked(requestThumbnails).mockResolvedValue({ id: 't' } as never)
  vi.mocked(followJob).mockResolvedValue(previewJob())
})

afterEach(() => {
  vi.resetAllMocks()
})

async function openDialog(): Promise<HTMLElement> {
  await renderApp('/')
  useAppStore.getState().setNewDocumentOpen(true)
  return screen.findByRole('dialog', { name: 'New document' })
}

describe('NewDocumentDialog', () => {
  it('offers a name and a canvas, with a size to start from', async () => {
    await openDialog()

    expect(screen.getByLabelText('Name')).toHaveValue('Untitled')
    expect(screen.getByLabelText('Width (px)')).toHaveValue('1920')
    expect(screen.getByLabelText('Height (px)')).toHaveValue('1080')
    expect(
      screen.getByRole('switch', { name: 'Transparent background' }),
    ).toBeChecked()
  })

  it('makes a blank document on the canvas chosen, and opens it', async () => {
    vi.mocked(createBlankDocument).mockResolvedValue(documentView([]))
    const user = userEvent.setup()
    await openDialog()
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Banner')
    await user.clear(screen.getByLabelText('Width (px)'))
    await user.type(screen.getByLabelText('Width (px)'), '640')

    await user.click(screen.getByRole('button', { name: 'Create document' }))

    await waitFor(() =>
      expect(createBlankDocument).toHaveBeenCalledWith({
        data: {
          name: 'Banner',
          canvas: { width: 640, height: 1080, background: 'transparent' },
        },
      }),
    )
    await waitFor(() =>
      expect(useAppStore.getState().newDocumentOpen).toBe(false),
    )
    await waitFor(() =>
      expect(getDocument).toHaveBeenCalledWith({ data: { id: DOCUMENT_ID } }),
    )
  })

  it('does not ask the server when the name is empty or the canvas is not valid', async () => {
    const user = userEvent.setup()
    await openDialog()

    await user.clear(screen.getByLabelText('Name'))
    expect(
      screen.getByRole('button', { name: 'Create document' }),
    ).toBeDisabled()

    await user.type(screen.getByLabelText('Name'), 'A')
    await user.clear(screen.getByLabelText('Width (px)'))
    await user.type(screen.getByLabelText('Width (px)'), '0')
    await user.click(screen.getByRole('button', { name: 'Create document' }))

    expect(createBlankDocument).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeVisible()
  })

  it('says so when the server refuses, and stays open', async () => {
    vi.mocked(createBlankDocument).mockRejectedValue(new Error('No room.'))
    const user = userEvent.setup()
    await openDialog()

    await user.click(screen.getByRole('button', { name: 'Create document' }))

    expect(await screen.findByText('No room.')).toBeVisible()
    expect(useAppStore.getState().newDocumentOpen).toBe(true)
  })
})
