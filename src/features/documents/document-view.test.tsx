import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getDocument,
  listDocuments,
} from '@/features/documents/document-functions'
import { followJob } from '@/features/jobs/follow-job'
import { JobKind } from '@/server/jobs/job-types'
import { useUiStore } from '@/store/ui-store'
import {
  requestPreview,
  requestThumbnails,
} from '@/features/render/render-functions'
import { listWorkflows } from '@/features/workflows/workflow-functions'

import { DOCUMENT_ID, documentView, previewJob } from '@/test/document-fixtures'
import { renderApp } from '@/test/render-app'
import { pipelineOf } from '@/test/pipelines'
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
  resetStores()
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
  vi.unstubAllGlobals()
})

/** The preview job's picture is this big in its own pixels. */
function renderedAt(width: number, height: number): void {
  vi.mocked(followJob).mockResolvedValue({
    ...previewJob(),
    result: {
      kind: JobKind.Preview,
      key: 'preview-key',
      width,
      height,
      pendingStepIds: [],
      problems: [],
    },
  })
}

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

  it('is as big as the rendered picture in its own pixels, not the original or the shrunk preview', async () => {
    renderedAt(4000, 1000)
    await renderApp(`/documents/${DOCUMENT_ID}`)
    const picture = await screen.findByRole('img', { name: 'one.png' })
    Object.defineProperty(picture, 'naturalWidth', { value: 2560 })
    Object.defineProperty(picture, 'naturalHeight', { value: 640 })
    fireEvent.load(picture)

    const canvas = picture.closest<HTMLElement>('[data-slot="canvas"]')
    expect(canvas?.style.width).toBe('4000px')
    expect(canvas?.style.height).toBe('1000px')
  })

  it('is as big as the original while comparing with it', async () => {
    vi.stubGlobal(
      'Image',
      class LoadingImage {
        onload: (() => void) | null = null
        set src(_url: string) {
          queueMicrotask(() => this.onload?.())
        }
      },
    )
    renderedAt(4000, 1000)
    await renderApp(`/documents/${DOCUMENT_ID}`)
    await screen.findByRole('img', { name: 'one.png' })

    await act(async () => {
      useUiStore.getState().setShowOriginal(DOCUMENT_ID, true)
    })

    const source = documentView().source
    const canvas = document.querySelector<HTMLElement>('[data-slot="canvas"]')
    expect(canvas?.style.width).toBe(`${source?.width}px`)
  })
})
