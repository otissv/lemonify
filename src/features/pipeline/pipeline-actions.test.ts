import { beforeEach, describe, expect, it, vi } from 'vitest'

import { applyEdit } from '@/features/documents/document-sync'
import { createLayerStep, createSharpStep } from '@/features/pipeline/pipeline'
import {
  insertImage,
  replaceImage,
  renameStep,
  setLayerSettings,
  setStepBlend,
} from '@/features/pipeline/pipeline-actions'
import { INITIAL_APP_STATE, useAppStore } from '@/store/app-store'
import {
  DOCUMENT_ID,
  documentView,
  loadDocumentIntoEditor,
  baseLayer,
} from '@/test/document-fixtures'

vi.mock('@/features/documents/document-sync', () => ({
  applyEdit: vi.fn().mockResolvedValue(undefined),
}))

const IMAGE = baseLayer(`source-${DOCUMENT_ID}`)

beforeEach(() => {
  vi.mocked(applyEdit).mockClear()
  useAppStore.setState(INITIAL_APP_STATE)
})

describe('insertImage', () => {
  it('adds a layer just after the selected step, on top of it', () => {
    const blur = createSharpStep('blur')
    const flip = createSharpStep('flip')
    loadDocumentIntoEditor(documentView([blur, flip]))
    useAppStore.getState().selectStep(DOCUMENT_ID, blur.id)

    insertImage(DOCUMENT_ID, 'mask')

    expect(applyEdit).toHaveBeenCalledWith(DOCUMENT_ID, {
      type: 'add-step',
      step: expect.objectContaining({ kind: 'layer', sourceId: 'mask' }),
      index: 2,
    })
  })

  it('adds it on top of everything when no step is selected', () => {
    loadDocumentIntoEditor(documentView([createSharpStep('blur')]))

    insertImage(DOCUMENT_ID, 'mask')

    expect(applyEdit).toHaveBeenCalledWith(DOCUMENT_ID, {
      type: 'add-step',
      step: expect.objectContaining({ kind: 'layer', sourceId: 'mask' }),
      index: 2,
    })
  })

  it('puts it just above the document’s image when that is selected', () => {
    loadDocumentIntoEditor(documentView([createSharpStep('blur')]))
    useAppStore.getState().selectStep(DOCUMENT_ID, IMAGE.id)

    insertImage(DOCUMENT_ID, 'mask')

    expect(applyEdit).toHaveBeenCalledWith(DOCUMENT_ID, {
      type: 'add-step',
      step: expect.objectContaining({ kind: 'layer' }),
      index: 1,
    })
  })

  it('selects the new layer and shows its options', () => {
    loadDocumentIntoEditor(documentView([]))

    insertImage(DOCUMENT_ID, 'mask')

    const added = vi.mocked(applyEdit).mock.calls[0]?.[1]
    if (added?.type !== 'add-step') throw new Error('no step added')
    expect(useAppStore.getState().selectedSteps[DOCUMENT_ID]).toBe(
      added.step.id,
    )
    expect(useAppStore.getState().activeTool).toBe('options')
  })
})

describe('replaceImage', () => {
  it('makes the selected layer use the other image', () => {
    const layer = createLayerStep('second')
    loadDocumentIntoEditor(documentView([layer]))
    useAppStore.getState().selectStep(DOCUMENT_ID, layer.id)

    replaceImage(DOCUMENT_ID, 'other')

    expect(applyEdit).toHaveBeenCalledWith(DOCUMENT_ID, {
      type: 'set-source',
      stepId: layer.id,
      sourceId: 'other',
    })
  })

  it('replaces the document’s image when the selected step is not an image', () => {
    const blur = createSharpStep('blur')
    loadDocumentIntoEditor(documentView([blur]))
    useAppStore.getState().selectStep(DOCUMENT_ID, blur.id)

    replaceImage(DOCUMENT_ID, 'other')

    expect(applyEdit).toHaveBeenCalledWith(DOCUMENT_ID, {
      type: 'set-source',
      stepId: IMAGE.id,
      sourceId: 'other',
    })
  })

  it('replaces the document’s image when nothing is selected', () => {
    loadDocumentIntoEditor(documentView([createLayerStep('second')]))

    replaceImage(DOCUMENT_ID, 'other')

    expect(applyEdit).toHaveBeenCalledWith(DOCUMENT_ID, {
      type: 'set-source',
      stepId: IMAGE.id,
      sourceId: 'other',
    })
  })

  it('replaces the first layer when every layer is switched off', () => {
    const off = { ...createLayerStep('only'), enabled: false }
    const view = documentView([])
    loadDocumentIntoEditor({ ...view, pipeline: { steps: [off] } })

    replaceImage(DOCUMENT_ID, 'other')

    expect(applyEdit).toHaveBeenCalledWith(DOCUMENT_ID, {
      type: 'set-source',
      stepId: off.id,
      sourceId: 'other',
    })
  })

  it('does nothing when there is no layer to replace', () => {
    loadDocumentIntoEditor({ ...documentView(), pipeline: { steps: [] } })

    replaceImage(DOCUMENT_ID, 'other')

    expect(applyEdit).not.toHaveBeenCalled()
  })

  it('does nothing when the document is not open', () => {
    replaceImage(DOCUMENT_ID, 'other')

    expect(applyEdit).not.toHaveBeenCalled()
  })
})

describe('setStepBlend', () => {
  const BLEND = { mode: 'multiply', opacity: 40 } as const

  it('sets the blend of a filter or colour step as one change', () => {
    const blur = createSharpStep('blur')
    loadDocumentIntoEditor(documentView([blur]))

    setStepBlend(DOCUMENT_ID, blur.id, BLEND)

    expect(applyEdit).toHaveBeenCalledWith(DOCUMENT_ID, {
      type: 'set-blend',
      stepId: blur.id,
      blend: BLEND,
    })
  })

  it('does nothing for a geometry step, a layer, or a step that is gone', () => {
    const flip = createSharpStep('flip')
    const layer = createLayerStep('logo')
    loadDocumentIntoEditor(documentView([flip, layer]))

    for (const id of [flip.id, layer.id, 'gone']) {
      setStepBlend(DOCUMENT_ID, id, BLEND)
    }

    expect(applyEdit).not.toHaveBeenCalled()
  })
})

describe('renameStep', () => {
  it('renames a step as one change', () => {
    const blur = createSharpStep('blur')
    loadDocumentIntoEditor(documentView([blur]))

    renameStep(DOCUMENT_ID, blur.id, 'Soften')

    expect(applyEdit).toHaveBeenCalledWith(DOCUMENT_ID, {
      type: 'rename-step',
      stepId: blur.id,
      name: 'Soften',
    })
  })

  it('does nothing for a step that is gone', () => {
    loadDocumentIntoEditor(documentView([]))

    renameStep(DOCUMENT_ID, 'gone', 'Soften')

    expect(applyEdit).not.toHaveBeenCalled()
  })
})

describe('setLayerSettings', () => {
  const SETTINGS = {
    opacity: 50,
    blend: 'multiply',
    fit: 'cover',
    scale: 120,
    rotation: 10,
    anchor: 'north',
    x: 4,
    y: -2,
  } as const

  it('sets a layer’s settings as one change', () => {
    const layer = createLayerStep('second')
    loadDocumentIntoEditor(documentView([layer]))

    setLayerSettings(DOCUMENT_ID, layer.id, SETTINGS)

    expect(applyEdit).toHaveBeenCalledWith(DOCUMENT_ID, {
      type: 'set-layer',
      stepId: layer.id,
      settings: SETTINGS,
    })
  })

  it('does nothing for a step that is not a layer', () => {
    const blur = createSharpStep('blur')
    loadDocumentIntoEditor(documentView([blur]))

    setLayerSettings(DOCUMENT_ID, blur.id, SETTINGS)

    expect(applyEdit).not.toHaveBeenCalled()
  })
})
