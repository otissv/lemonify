import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
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
import { pipelineOf } from '@/test/pipelines'

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

beforeEach(() => {
  useAppStore.setState(INITIAL_APP_STATE)
  const view = documentView()
  vi.mocked(listWorkflows).mockResolvedValue([])
  vi.mocked(listDocuments).mockResolvedValue([
    {
      id: DOCUMENT_ID,
      name: view.name,
      source: view.source,
      revision: 0,
      updatedAt: view.updatedAt,
    },
  ])
  vi.mocked(getDocument).mockResolvedValue(view)
  vi.mocked(requestPreview).mockResolvedValue({ id: 'p' } as never)
  vi.mocked(requestThumbnails).mockResolvedValue({ id: 't' } as never)
  vi.mocked(followJob).mockResolvedValue(previewJob())
})

afterEach(() => {
  vi.resetAllMocks()
})

describe('DocumentView', () => {
  it('shows a blank canvas of its own size when the document has no image', async () => {
    vi.mocked(getDocument).mockResolvedValue({
      ...documentView(),
      source: null,
      sources: [],
      pipeline: pipelineOf(),
    })
    await renderApp(`/documents/${DOCUMENT_ID}`)

    const picture = await screen.findByRole('img', { name: 'one.png' })
    expect(picture).toHaveAttribute('src', expect.stringContaining('preview'))
  })

  it('says it is rendering until the first picture is ready', async () => {
    vi.mocked(followJob).mockReturnValue(new Promise(() => undefined))
    await renderApp(`/documents/${DOCUMENT_ID}`)

    expect(await screen.findByRole('status')).toHaveTextContent('Rendering…')
  })

  it('shows the picture on a checkerboard, so transparency can be seen', async () => {
    await renderApp(`/documents/${DOCUMENT_ID}`)

    const picture = await screen.findByRole('img', { name: 'one.png' })
    fireEvent.load(picture)

    expect(picture.closest('[data-slot="canvas"]')).toHaveClass(
      'bg-checkerboard',
    )
  })

  it('takes the shape of the picture once it has loaded, not of the original', async () => {
    await renderApp(`/documents/${DOCUMENT_ID}`)
    const picture = await screen.findByRole('img', { name: 'one.png' })
    const canvas = picture.closest<HTMLElement>('[data-slot="canvas"]')
    expect(canvas?.style.getPropertyValue('--ratio')).toBe('1')

    Object.defineProperty(picture, 'naturalWidth', { value: 400 })
    Object.defineProperty(picture, 'naturalHeight', { value: 100 })
    fireEvent.load(picture)

    expect(canvas?.style.getPropertyValue('--ratio')).toBe('4')
  })
})
