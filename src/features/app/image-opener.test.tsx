import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createDocument,
  getDocument,
  listDocuments,
} from '@/features/documents/document-functions'
import { uploadSource } from '@/features/documents/upload-source'
import { listSources } from '@/features/sources/source-functions'
import { listWorkflows } from '@/features/workflows/workflow-functions'

import { DOCUMENT_ID, documentView } from '@/test/document-fixtures'
import { renderApp } from '@/test/render-app'
import { resetStores } from '@/store/reset-stores'

vi.mock('@/features/documents/document-functions', () => ({
  listDocuments: vi.fn(),
  getDocument: vi.fn(),
  createDocument: vi.fn(),
  deleteDocument: vi.fn(),
  changeDocument: vi.fn(),
  undoDocument: vi.fn(),
  redoDocument: vi.fn(),
}))
vi.mock('@/features/documents/upload-source', () => ({
  uploadSource: vi.fn(),
}))
vi.mock('@/features/sources/source-functions', () => ({
  listSources: vi.fn(),
  deleteSource: vi.fn(),
}))
vi.mock('@/features/workflows/workflow-functions', () => ({
  listWorkflows: vi.fn(),
}))

describe('ImageOpener', () => {
  beforeEach(() => {
    resetStores()
    vi.mocked(listDocuments).mockResolvedValue([])
    vi.mocked(listWorkflows).mockResolvedValue([])
    vi.mocked(listSources).mockResolvedValue([])
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('is mounted once, so the page and the menu share one file chooser', async () => {
    await renderApp()

    expect(await screen.findAllByLabelText('Choose an image')).toHaveLength(1)
  })

  it('keeps the file chooser on pages that have a document', async () => {
    vi.mocked(getDocument).mockResolvedValue(documentView())
    await renderApp(`/documents/${DOCUMENT_ID}`)

    expect(await screen.findAllByLabelText('Choose an image')).toHaveLength(1)
  })

  it('opens an uploaded image as a document', async () => {
    const opened = documentView([], DOCUMENT_ID, 'one.png')
    vi.mocked(uploadSource).mockResolvedValue(opened.source)
    vi.mocked(createDocument).mockResolvedValue(opened)
    vi.mocked(getDocument).mockResolvedValue(opened)
    const user = userEvent.setup()
    const { router } = await renderApp()

    await user.upload(
      await screen.findByLabelText('Choose an image'),
      new File(['x'], 'one.png', { type: 'image/png' }),
    )

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/documents/${DOCUMENT_ID}`)
    })
  })

  it('shows why an image was refused in a fixed alert that overlays the page', async () => {
    vi.mocked(uploadSource).mockRejectedValue(
      new Error('Use one of: image/png.'),
    )
    const user = userEvent.setup({ applyAccept: false })
    await renderApp()

    await user.upload(
      await screen.findByLabelText('Choose an image'),
      new File(['x'], 'a.txt', { type: 'text/plain' }),
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Use one of: image/png.')
    expect(alert).toHaveClass('fixed')
  })
})
