import { beforeEach, describe, expect, it, vi } from 'vitest'

import { applyEdit } from '@/features/documents/document-sync'
import { createSharpStep, createSourceStep } from '@/features/pipeline/pipeline'
import { insertImage, replaceImage } from '@/features/pipeline/pipeline-actions'
import { INITIAL_APP_STATE, useAppStore } from '@/store/app-store'
import {
  DOCUMENT_ID,
  documentView,
  loadDocumentIntoEditor,
  openImageStep,
} from '@/test/document-fixtures'

vi.mock('@/features/documents/document-sync', () => ({
  applyEdit: vi.fn().mockResolvedValue(undefined),
}))

const FIRST_SOURCE = `source-${DOCUMENT_ID}`

beforeEach(() => {
  vi.mocked(applyEdit).mockClear()
  useAppStore.setState(INITIAL_APP_STATE)
})

describe('insertImage', () => {
  it('adds an Open image step just before the selected step, so that step can use it', () => {
    const blur = createSharpStep('blur')
    const flip = createSharpStep('flip')
    loadDocumentIntoEditor(documentView([blur, flip]))
    useAppStore.getState().selectStep(DOCUMENT_ID, flip.id)

    insertImage(DOCUMENT_ID, 'mask')

    expect(applyEdit).toHaveBeenCalledWith(DOCUMENT_ID, {
      type: 'add-step',
      step: expect.objectContaining({ kind: 'source', sourceId: 'mask' }),
      index: 2,
    })
  })

  it('adds it at the end when no step is selected', () => {
    loadDocumentIntoEditor(documentView([createSharpStep('blur')]))

    insertImage(DOCUMENT_ID, 'mask')

    expect(applyEdit).toHaveBeenCalledWith(DOCUMENT_ID, {
      type: 'add-step',
      step: expect.objectContaining({ kind: 'source', sourceId: 'mask' }),
      index: 2,
    })
  })

  it('never puts it ahead of the document’s own image, which would make it the document’s image', () => {
    loadDocumentIntoEditor(documentView([createSharpStep('blur')]))
    useAppStore
      .getState()
      .selectStep(DOCUMENT_ID, openImageStep(FIRST_SOURCE).id)

    insertImage(DOCUMENT_ID, 'mask')

    expect(applyEdit).toHaveBeenCalledWith(DOCUMENT_ID, {
      type: 'add-step',
      step: expect.objectContaining({ kind: 'source', sourceId: 'mask' }),
      index: 1,
    })
  })

  it('selects the new step and shows its options', () => {
    const blur = createSharpStep('blur')
    loadDocumentIntoEditor(documentView([blur]))
    useAppStore.getState().selectStep(DOCUMENT_ID, blur.id)

    insertImage(DOCUMENT_ID, 'mask')

    const added = vi.mocked(applyEdit).mock.calls[0]?.[1]
    expect(added).toMatchObject({ type: 'add-step' })
    expect(useAppStore.getState().activeTool).toBe('options')
  })
})

describe('replaceImage', () => {
  it('makes the selected Open image step open the other image', () => {
    const second = createSourceStep('second')
    loadDocumentIntoEditor(documentView([second]))
    useAppStore.getState().selectStep(DOCUMENT_ID, second.id)

    replaceImage(DOCUMENT_ID, 'other')

    expect(applyEdit).toHaveBeenCalledWith(DOCUMENT_ID, {
      type: 'set-source',
      stepId: second.id,
      sourceId: 'other',
    })
  })

  it('replaces the document’s own image when the selected step is not an Open image step', () => {
    const blur = createSharpStep('blur')
    loadDocumentIntoEditor(documentView([blur]))
    useAppStore.getState().selectStep(DOCUMENT_ID, blur.id)

    replaceImage(DOCUMENT_ID, 'other')

    expect(applyEdit).toHaveBeenCalledWith(DOCUMENT_ID, {
      type: 'set-source',
      stepId: openImageStep(FIRST_SOURCE).id,
      sourceId: 'other',
    })
  })

  it('replaces the first image that is switched on when nothing is selected', () => {
    const off = { ...createSourceStep('off'), enabled: false }
    const on = createSourceStep('on')
    loadDocumentIntoEditor(documentView([]))
    const view = documentView([])
    loadDocumentIntoEditor({
      ...view,
      pipeline: { steps: [off, on, ...view.pipeline.steps] },
    })

    replaceImage(DOCUMENT_ID, 'other')

    expect(applyEdit).toHaveBeenCalledWith(DOCUMENT_ID, {
      type: 'set-source',
      stepId: on.id,
      sourceId: 'other',
    })
  })

  it('does nothing when the document is not open', () => {
    replaceImage(DOCUMENT_ID, 'other')

    expect(applyEdit).not.toHaveBeenCalled()
  })
})
