import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_LAYER_SETTINGS } from '@/features/pipeline/layer'
import { applyEdit, loadDocument } from '@/features/documents/document-sync'
import {
  createGroupStep,
  createLayerStep,
  createSharpStep,
} from '@/features/pipeline/pipeline'
import {
  addStepAfter,
  copyStepToDocument,
  groupSteps,
  insertImage,
  reorderStep,
  setSubDocument,
  ungroupSteps,
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
  loadDocument: vi.fn().mockResolvedValue(undefined),
}))

const IMAGE = baseLayer(`source-${DOCUMENT_ID}`)

beforeEach(() => {
  vi.mocked(applyEdit).mockClear()
  vi.mocked(loadDocument).mockReset().mockResolvedValue(undefined)
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

describe('copyStepToDocument', () => {
  const OTHER_ID = '7a2d7d5f-1f54-4b9a-8b68-3e3a1a9a3c22'

  function load(): { layer: ReturnType<typeof createLayerStep> } {
    const layer = createLayerStep('second')
    loadDocumentIntoEditor(documentView([createSharpStep('blur'), layer]))
    loadDocumentIntoEditor(documentView([createSharpStep('flip')], OTHER_ID))
    return { layer }
  }

  it('adds a copy of the step on top of the other document, with an id of its own', async () => {
    const { layer } = load()

    const failure = await copyStepToDocument(DOCUMENT_ID, layer.id, OTHER_ID)

    expect(failure).toBeUndefined()
    expect(applyEdit).toHaveBeenCalledWith(OTHER_ID, {
      type: 'add-step',
      step: { ...layer, id: expect.not.stringMatching(layer.id) },
      index: 2,
    })
  })

  it('copies steps of every kind, settings and blend included', async () => {
    const blur = {
      ...createSharpStep('blur', { sigma: 4 }),
      name: 'Soften',
      blend: { mode: 'multiply', opacity: 40 },
    } as const
    loadDocumentIntoEditor(documentView([blur]))
    loadDocumentIntoEditor(documentView([], OTHER_ID))

    await copyStepToDocument(DOCUMENT_ID, blur.id, OTHER_ID)

    expect(applyEdit).toHaveBeenCalledWith(OTHER_ID, {
      type: 'add-step',
      step: { ...blur, id: expect.not.stringMatching(blur.id) },
      index: 1,
    })
  })

  it('leaves the step where it is, so it is a copy and not a move', async () => {
    const { layer } = load()

    await copyStepToDocument(DOCUMENT_ID, layer.id, OTHER_ID)

    expect(applyEdit).toHaveBeenCalledTimes(1)
    expect(applyEdit).not.toHaveBeenCalledWith(DOCUMENT_ID, expect.anything())
  })

  it('shows the steps of the document it was copied to', async () => {
    const { layer } = load()

    await copyStepToDocument(DOCUMENT_ID, layer.id, OTHER_ID)

    expect(useAppStore.getState().expandedDocuments[OTHER_ID]).toBe(true)
  })

  it('reads the other document first when the editor does not have it yet', async () => {
    const { layer } = load()
    useAppStore.getState().forgetDocument(OTHER_ID)
    vi.mocked(loadDocument).mockImplementation(async () => {
      loadDocumentIntoEditor(documentView([], OTHER_ID))
    })

    await copyStepToDocument(DOCUMENT_ID, layer.id, OTHER_ID)

    expect(loadDocument).toHaveBeenCalledWith(OTHER_ID)
    expect(applyEdit).toHaveBeenCalledWith(OTHER_ID, {
      type: 'add-step',
      step: expect.objectContaining({ sourceId: 'second' }),
      index: 1,
    })
  })

  it('says why when the other document could not be read', async () => {
    const { layer } = load()
    useAppStore.getState().forgetDocument(OTHER_ID)
    vi.mocked(loadDocument).mockRejectedValue(new Error('Gone.'))

    const failure = await copyStepToDocument(DOCUMENT_ID, layer.id, OTHER_ID)

    expect(failure).toBe('Gone.')
    expect(applyEdit).not.toHaveBeenCalled()
  })

  it('says why when the other document would not take it', async () => {
    const { layer } = load()
    vi.mocked(applyEdit).mockImplementation(async () => {
      useAppStore.getState().setDocumentError(OTHER_ID, 'Not allowed.')
    })

    const failure = await copyStepToDocument(DOCUMENT_ID, layer.id, OTHER_ID)

    expect(failure).toBe('Not allowed.')
  })

  it('does nothing for the same document or a step that is gone', async () => {
    const { layer } = load()

    expect(
      await copyStepToDocument(DOCUMENT_ID, layer.id, DOCUMENT_ID),
    ).toBeUndefined()
    expect(
      await copyStepToDocument(DOCUMENT_ID, 'missing', OTHER_ID),
    ).toBeUndefined()
    expect(applyEdit).not.toHaveBeenCalled()
  })
})

describe('groups', () => {
  const blur = createSharpStep('blur')
  const flip = createSharpStep('flip')
  const group = createGroupStep([blur], 'Look')

  it('adds a step after one in a group, inside that group', () => {
    loadDocumentIntoEditor(documentView([group]))
    const added = createSharpStep('flop')

    addStepAfter(DOCUMENT_ID, added, blur.id)

    expect(applyEdit).toHaveBeenCalledWith(DOCUMENT_ID, {
      type: 'add-step',
      step: added,
      index: 1,
      groupId: group.id,
    })
  })

  it('adds a step after a group, at the top level', () => {
    loadDocumentIntoEditor(documentView([group]))
    const added = createSharpStep('flop')

    addStepAfter(DOCUMENT_ID, added, group.id)

    expect(applyEdit).toHaveBeenCalledWith(DOCUMENT_ID, {
      type: 'add-step',
      step: added,
      index: 2,
    })
  })

  it('moves a step to a place inside a group, or out of it', () => {
    reorderStep(DOCUMENT_ID, flip.id, 0, group.id)
    reorderStep(DOCUMENT_ID, flip.id, 0)

    expect(vi.mocked(applyEdit).mock.calls.map(([, change]) => change)).toEqual(
      [
        { type: 'move-step', stepId: flip.id, to: 0, groupId: group.id },
        { type: 'move-step', stepId: flip.id, to: 0 },
      ],
    )
  })

  it('groups steps that are next to each other, and selects the group', () => {
    loadDocumentIntoEditor(documentView([blur, flip]))

    const failure = groupSteps(DOCUMENT_ID, [blur.id, flip.id])

    expect(failure).toBeUndefined()
    const change = vi.mocked(applyEdit).mock.calls[0]?.[1]
    expect(change).toMatchObject({
      type: 'group-steps',
      group: { kind: 'group', steps: [blur, flip] },
    })
    expect(useAppStore.getState().selectedSteps[DOCUMENT_ID]).toBe(
      change?.type === 'group-steps' ? change.group.id : undefined,
    )
  })

  it('says why steps cannot be grouped, and changes nothing', () => {
    const layer = createLayerStep('second')
    loadDocumentIntoEditor(documentView([blur, layer, flip]))

    expect(groupSteps(DOCUMENT_ID, [blur.id, flip.id])).toMatch(
      /next to each other/,
    )
    expect(groupSteps(DOCUMENT_ID, [])).toMatch(/next to each other/)
    expect(applyEdit).not.toHaveBeenCalled()
  })

  it('takes a group apart and clears the selection when it was the group', () => {
    loadDocumentIntoEditor(documentView([group]))
    useAppStore.getState().selectStep(DOCUMENT_ID, group.id)

    ungroupSteps(DOCUMENT_ID, group.id)

    expect(applyEdit).toHaveBeenCalledWith(DOCUMENT_ID, {
      type: 'ungroup',
      groupId: group.id,
    })
    expect(useAppStore.getState().selectedSteps[DOCUMENT_ID]).toBeUndefined()
  })

  it('makes a group a sub-document only for a group', () => {
    loadDocumentIntoEditor(documentView([group, flip]))

    setSubDocument(DOCUMENT_ID, group.id, true)
    setSubDocument(DOCUMENT_ID, flip.id, true)

    expect(applyEdit).toHaveBeenCalledTimes(1)
    expect(applyEdit).toHaveBeenCalledWith(DOCUMENT_ID, {
      type: 'set-sub-document',
      stepId: group.id,
      subDocument: true,
    })
  })

  it('places a sub-document with the layer settings', () => {
    loadDocumentIntoEditor(documentView([group]))

    setLayerSettings(DOCUMENT_ID, group.id, { ...DEFAULT_LAYER_SETTINGS, x: 4 })

    expect(applyEdit).toHaveBeenCalledWith(DOCUMENT_ID, {
      type: 'set-layer',
      stepId: group.id,
      settings: { ...DEFAULT_LAYER_SETTINGS, x: 4 },
    })
  })

  it('copies a group to another document, with new ids for it and its steps', async () => {
    const other = '7a2d7d5f-1f54-4b9a-8b68-3e3a1a9a3c22'
    loadDocumentIntoEditor(documentView([group]))
    loadDocumentIntoEditor(documentView([], other))

    await copyStepToDocument(DOCUMENT_ID, group.id, other)

    const change = vi.mocked(applyEdit).mock.calls[0]?.[1]
    if (change?.type !== 'add-step') throw new Error('expected add-step')
    expect(change.step).toMatchObject({ kind: 'group', name: 'Look' })
    expect(change.step.id).not.toBe(group.id)
    const copied =
      change.step.kind === 'group' ? change.step.steps[0] : undefined
    expect(copied).toMatchObject({ kind: 'sharp', op: 'blur' })
    expect(copied?.id).not.toBe(blur.id)
  })
})
