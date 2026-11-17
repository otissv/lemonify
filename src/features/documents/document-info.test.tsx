import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { changeDocument } from '@/features/documents/document-functions'

import { DocumentInfo } from '@/features/documents/document-info'
import { createAiStep, createSharpStep } from '@/features/pipeline/pipeline'
import { createImageLayerStep } from '@/features/pipeline/layer-kinds'
import { AiToolId } from '@/features/ai/ai-tools'
import {
  INITIAL_APP_STATE,
  currentPipeline,
  useAppStore,
} from '@/store/app-store'
import {
  DOCUMENT_ID,
  documentView,
  echoChanges,
  loadDocumentIntoEditor,
} from '@/test/document-fixtures'

vi.mock('@/features/documents/document-functions', () => ({
  getDocument: vi.fn(),
  changeDocument: vi.fn(),
  undoDocument: vi.fn(),
  redoDocument: vi.fn(),
}))
vi.mock('@/features/render/render-functions', () => ({
  requestPreview: vi.fn(),
  requestThumbnails: vi.fn(),
  requestAiStep: vi.fn(),
}))
vi.mock('@/features/jobs/follow-job', () => ({ followJob: vi.fn() }))

const UPSCALE = createAiStep({
  tool: AiToolId.Upscale,
  settings: { model: 'm', scale: 4, iterations: 1, tta: false },
})

beforeEach(() => {
  useAppStore.setState(INITIAL_APP_STATE)
})

function show(): void {
  render(<DocumentInfo documentId={DOCUMENT_ID} />)
}

function value(term: string): string | null {
  const row = screen.getByText(term).closest('div')
  return row?.querySelector('dd')?.textContent ?? null
}

describe('DocumentInfo', () => {
  it('lists the document and its image', () => {
    loadDocumentIntoEditor(documentView())

    show()

    expect(screen.getByRole('heading', { name: 'Document' })).toBeVisible()
    expect(value('Name')).toBe('one.png')
    expect(value('Canvas size')).toBe('10 × 10 px')
    expect(value('Background')).toBe('transparent')
    expect(value('Original image')).toBe('one.png')
    expect(value('Image size')).toBe('10 × 10 px')
    expect(value('Image type')).toBe('PNG')
    expect(value('File size')).toBe('100 B')
    expect(value('Id')).toBe(DOCUMENT_ID)
  })

  it('counts the steps by kind', () => {
    loadDocumentIntoEditor(
      documentView([
        createSharpStep('blur'),
        createSharpStep('flip'),
        createImageLayerStep('logo'),
        UPSCALE,
      ]),
    )

    show()

    expect(value('Steps')).toBe('5')
    expect(value('Layers')).toBe('2')
    expect(value('Effects')).toBe('2')
    expect(value('AI steps')).toBe('1')
  })

  it('says when it was made and last changed, and which revision it is', () => {
    loadDocumentIntoEditor({ ...documentView(), revision: 7 })

    show()

    expect(value('Created')).toMatch(/2026/)
    expect(value('Last changed')).toMatch(/2026/)
    expect(value('Revision')).toBe('7')
  })

  it('says so when there is no original image', () => {
    const view = documentView()
    loadDocumentIntoEditor({ ...view, source: null, sources: [] })

    show()

    expect(value('Original image')).toBe('None')
    expect(screen.queryByText('Image size')).not.toBeInTheDocument()
  })

  it('shows nothing while the document is not open', () => {
    show()

    expect(screen.queryByRole('heading', { name: 'Document' })).toBeNull()
  })

  describe('the canvas', () => {
    it('shows the canvas in a form, to change it', () => {
      loadDocumentIntoEditor(documentView())

      show()

      expect(screen.getByLabelText('Width (px)')).toHaveValue('10')
      expect(screen.getByLabelText('Height (px)')).toHaveValue('10')
    })

    it('changes the canvas as one edit, and keeps the steps', async () => {
      const view = documentView([createSharpStep('blur')])
      echoChanges(vi.mocked(changeDocument), view)
      loadDocumentIntoEditor(view)
      const user = userEvent.setup()
      show()

      await user.clear(screen.getByLabelText('Width (px)'))
      await user.type(screen.getByLabelText('Width (px)'), '200')
      await user.click(screen.getByRole('button', { name: 'Change canvas' }))

      await waitFor(() =>
        expect(
          currentPipeline(useAppStore.getState(), DOCUMENT_ID)?.canvas,
        ).toEqual({
          width: 200,
          height: 10,
          background: 'transparent',
        }),
      )
      expect(
        currentPipeline(useAppStore.getState(), DOCUMENT_ID)?.steps,
      ).toHaveLength(2)
      expect(changeDocument).toHaveBeenCalledTimes(1)
    })

    it('shows the canvas again after an undo changes it elsewhere', () => {
      const view = documentView()
      loadDocumentIntoEditor(view)
      show()
      act(() => {
        loadDocumentIntoEditor({
          ...view,
          revision: 1,
          pipeline: {
            ...view.pipeline,
            canvas: { width: 33, height: 22, background: '#112233' },
          },
        })
      })

      expect(screen.getByLabelText('Width (px)')).toHaveValue('33')
      expect(screen.getByLabelText('Background colour')).toHaveValue('#112233')
    })
  })
})
