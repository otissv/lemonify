import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ImageOpener } from '@/features/app/image-opener'
import {
  applyEdit,
  redoEdit,
  undoEdit,
} from '@/features/documents/document-sync'
import { canRunAction, runAction } from '@/features/keybindings/action-runner'
import type { ActionContext } from '@/features/keybindings/action-runner'
import { createGroupStep, createSharpStep } from '@/features/pipeline/pipeline'
import { Tool, INITIAL_APP_STATE, useAppStore } from '@/store/app-store'
import {
  AI_CATALOGUES,
  DOCUMENT_ID,
  documentView,
  loadDocumentIntoEditor,
} from '@/test/document-fixtures'

vi.mock('@/features/documents/document-sync', () => ({
  applyEdit: vi.fn().mockResolvedValue(undefined),
  loadDocument: vi.fn().mockResolvedValue(undefined),
  undoEdit: vi.fn().mockResolvedValue(undefined),
  redoEdit: vi.fn().mockResolvedValue(undefined),
}))

function opener(): ImageOpener {
  return {
    openImage: vi.fn(),
    openLibraryImage: vi.fn(),
    insertImage: vi.fn(),
    replaceImage: vi.fn(),
    opening: false,
    importDocument: vi.fn(),
    importing: false,
    exportDocument: vi.fn().mockResolvedValue(undefined),
  }
}

function context(overrides: Partial<ActionContext> = {}): ActionContext {
  return {
    documentId: DOCUMENT_ID,
    catalogues: AI_CATALOGUES,
    opener: opener(),
    closeDocument: vi.fn(),
    ...overrides,
  }
}

const blur = createSharpStep('blur')
const flip = createSharpStep('flip')
const rotate = createSharpStep('rotate')

beforeEach(() => {
  vi.mocked(applyEdit).mockClear()
  vi.mocked(undoEdit).mockClear()
  vi.mocked(redoEdit).mockClear()
  useAppStore.setState(INITIAL_APP_STATE)
})

describe('actions on a page with no document', () => {
  it('open and import images, show the library, the sidebar and the shortcuts', () => {
    const page = context({ documentId: undefined })
    expect(runAction('file.openImage', page)).toBe(true)
    expect(runAction('file.openLibrary', page)).toBe(true)
    expect(runAction('file.importDocument', page)).toBe(true)
    expect(page.opener.openImage).toHaveBeenCalled()
    expect(page.opener.openLibraryImage).toHaveBeenCalled()
    expect(page.opener.importDocument).toHaveBeenCalled()

    expect(useAppStore.getState().sidebarOpen).toBe(true)
    runAction('view.sidebar', page)
    expect(useAppStore.getState().sidebarOpen).toBe(false)
    runAction('help.shortcuts', page)
    expect(useAppStore.getState().shortcutsOpen).toBe(true)
    runAction('help.shortcuts', page)
    expect(useAppStore.getState().shortcutsOpen).toBe(false)
  })

  it('open the New document dialog, with or without a document open', () => {
    const page = context({ documentId: undefined })
    expect(canRunAction('file.newDocument', page)).toBe(true)

    expect(runAction('file.newDocument', page)).toBe(true)
    expect(useAppStore.getState().newDocumentOpen).toBe(true)

    useAppStore.getState().setNewDocumentOpen(false)
    loadDocumentIntoEditor(documentView())
    expect(runAction('file.newDocument', context())).toBe(true)
    expect(useAppStore.getState().newDocumentOpen).toBe(true)
  })

  it('do nothing that needs a document', () => {
    const page = context({ documentId: undefined })
    for (const id of [
      'edit.undo',
      'step.delete',
      'view.fit',
      'panel.tools',
      'tool.sharp.blur',
      'file.close',
    ]) {
      expect(runAction(id, page), id).toBe(false)
    }
  })

  it('do not open an image while one is being opened', () => {
    const busy = context({
      documentId: undefined,
      opener: { ...opener(), opening: true },
    })
    expect(canRunAction('file.openImage', busy)).toBe(false)
  })

  it('do nothing for an id that is not an action', () => {
    expect(runAction('nope', context())).toBe(false)
  })
})

describe('edit actions', () => {
  it('undo and redo only when there is something to undo or redo', () => {
    loadDocumentIntoEditor(documentView([blur]))
    expect(runAction('edit.undo', context())).toBe(false)
    expect(runAction('edit.redo', context())).toBe(false)
    loadDocumentIntoEditor({
      ...documentView([blur]),
      canUndo: true,
      canRedo: true,
    })
    expect(runAction('edit.undo', context())).toBe(true)
    expect(runAction('edit.redo', context())).toBe(true)
    expect(undoEdit).toHaveBeenCalledWith(DOCUMENT_ID)
    expect(redoEdit).toHaveBeenCalledWith(DOCUMENT_ID)
  })

  it('show the original only when there are edits to look past', () => {
    loadDocumentIntoEditor(documentView())
    expect(runAction('edit.showOriginal', context())).toBe(false)
    loadDocumentIntoEditor(documentView([blur]))
    expect(runAction('edit.showOriginal', context())).toBe(true)
    expect(useAppStore.getState().showOriginal[DOCUMENT_ID]).toBe(true)
    runAction('edit.showOriginal', context())
    expect(useAppStore.getState().showOriginal[DOCUMENT_ID]).toBe(false)
  })

  it('add an empty image layer for the document', () => {
    loadDocumentIntoEditor(documentView())
    expect(runAction('edit.addImageLayer', context())).toBe(true)
    expect(applyEdit).toHaveBeenCalledWith(DOCUMENT_ID, {
      type: 'add-step',
      step: expect.objectContaining({ kind: 'image-layer' }),
      index: 1,
    })
    expect(
      runAction('edit.addImageLayer', context({ documentId: undefined })),
    ).toBe(false)
  })

  it('insert and replace images, the latter only when there is a layer to replace', () => {
    loadDocumentIntoEditor(documentView())
    const page = context()
    expect(runAction('edit.insertImage', page)).toBe(true)
    expect(page.opener.insertImage).toHaveBeenCalledWith(DOCUMENT_ID)
    expect(runAction('edit.replaceImage', page)).toBe(true)
    expect(page.opener.replaceImage).toHaveBeenCalledWith(DOCUMENT_ID)
  })
})

describe('file and panel actions', () => {
  it('export, close and show panels for the document', () => {
    loadDocumentIntoEditor(documentView())
    const page = context()
    runAction('file.exportDocument', page)
    expect(page.opener.exportDocument).toHaveBeenCalledWith(DOCUMENT_ID)
    runAction('file.close', page)
    expect(page.closeDocument).toHaveBeenCalledWith(DOCUMENT_ID)
    runAction('file.exportImage', page)
    expect(useAppStore.getState().activeTool).toBe(Tool.Export)
    runAction('panel.navigator', page)
    expect(useAppStore.getState().activeTool).toBe(Tool.Navigator)
    runAction('panel.results', page)
    expect(useAppStore.getState().activeTool).toBe(Tool.Results)
  })
})

describe('step actions', () => {
  function select(id: string | undefined): void {
    useAppStore.getState().selectStep(DOCUMENT_ID, id)
  }

  beforeEach(() => {
    loadDocumentIntoEditor(documentView([blur, flip, rotate]))
  })

  it('need a selected step to delete, switch or move', () => {
    for (const id of [
      'step.delete',
      'step.toggle',
      'step.moveUp',
      'step.moveDown',
      'step.ungroup',
    ]) {
      expect(runAction(id, context()), id).toBe(false)
    }
    expect(applyEdit).not.toHaveBeenCalled()
  })

  it('delete and switch the selected step', () => {
    select(flip.id)
    expect(runAction('step.delete', context())).toBe(true)
    expect(applyEdit).toHaveBeenLastCalledWith(DOCUMENT_ID, {
      type: 'remove-step',
      stepId: flip.id,
    })
    select(flip.id)
    expect(runAction('step.toggle', context())).toBe(true)
    expect(applyEdit).toHaveBeenLastCalledWith(DOCUMENT_ID, {
      type: 'set-enabled',
      stepId: flip.id,
      enabled: false,
    })
  })

  it('move the selected step one place, and not past either end', () => {
    select(flip.id)
    expect(runAction('step.moveUp', context())).toBe(true)
    expect(applyEdit).toHaveBeenLastCalledWith(DOCUMENT_ID, {
      type: 'move-step',
      stepId: flip.id,
      to: 1,
    })
    select(rotate.id)
    expect(canRunAction('step.moveDown', context())).toBe(false)
    expect(canRunAction('step.moveUp', context())).toBe(true)
  })

  it('move the selection up and down the listed steps, starting from either end', () => {
    expect(runAction('step.selectDown', context())).toBe(true)
    const first = useAppStore.getState().selectedSteps[DOCUMENT_ID]
    select(undefined)
    runAction('step.selectUp', context())
    expect(useAppStore.getState().selectedSteps[DOCUMENT_ID]).toBe(rotate.id)
    runAction('step.selectUp', context())
    expect(useAppStore.getState().selectedSteps[DOCUMENT_ID]).toBe(flip.id)
    expect(first).toBeDefined()
  })

  it('group the picked steps, and say why when they cannot be grouped', () => {
    useAppStore.getState().markSteps(DOCUMENT_ID, [blur.id, flip.id])
    expect(runAction('step.group', context())).toBe(true)
    expect(applyEdit).toHaveBeenLastCalledWith(
      DOCUMENT_ID,
      expect.objectContaining({ type: 'group-steps' }),
    )
    useAppStore.getState().markSteps(DOCUMENT_ID, [blur.id, rotate.id])
    expect(runAction('step.group', context())).toBe(false)
  })

  it('ungroup the selected group', () => {
    const group = createGroupStep([blur, flip])
    loadDocumentIntoEditor(documentView([group, rotate]))
    select(group.id)
    expect(runAction('step.ungroup', context())).toBe(true)
    expect(applyEdit).toHaveBeenLastCalledWith(DOCUMENT_ID, {
      type: 'ungroup',
      groupId: group.id,
    })
    select(rotate.id)
    expect(canRunAction('step.ungroup', context())).toBe(false)
  })
})

describe('tool actions', () => {
  beforeEach(() => {
    loadDocumentIntoEditor(documentView([createSharpStep('blur')]))
  })

  it('add a Sharp tool as a step after the selected one', () => {
    expect(runAction('tool.sharp.resize', context())).toBe(true)
    expect(applyEdit).toHaveBeenCalledWith(
      DOCUMENT_ID,
      expect.objectContaining({
        type: 'add-step',
        step: expect.objectContaining({ op: 'resize' }),
      }),
    )
  })

  it('add an AI tool, but only when its catalogue is known', () => {
    expect(
      runAction('tool.ai.upscale', context({ catalogues: undefined })),
    ).toBe(false)
    expect(runAction('tool.ai.upscale', context())).toBe(true)
  })
})

describe('view actions', () => {
  it('wait until the picture has been measured', () => {
    loadDocumentIntoEditor(documentView())
    expect(runAction('view.zoomIn', context())).toBe(false)
    useAppStore.getState().setViewFrame(DOCUMENT_ID, {
      viewWidth: 400,
      viewHeight: 300,
      ratio: 1,
      naturalWidth: 1000,
    })
    expect(runAction('view.zoomIn', context())).toBe(true)
    expect(useAppStore.getState().viewports[DOCUMENT_ID]?.zoom).toBeGreaterThan(
      1,
    )
  })

  it('pan further for the far keys', () => {
    loadDocumentIntoEditor(documentView())
    useAppStore.getState().setViewFrame(DOCUMENT_ID, {
      viewWidth: 400,
      viewHeight: 300,
      ratio: 1,
      naturalWidth: 1000,
    })
    for (let step = 0; step < 4; step += 1) runAction('view.zoomIn', context())
    const start = useAppStore.getState().viewports[DOCUMENT_ID]
    if (start === undefined) throw new Error('no viewport')
    runAction('view.panLeft', context())
    const near = Math.abs(
      (useAppStore.getState().viewports[DOCUMENT_ID]?.x ?? 0) - start.x,
    )
    useAppStore.getState().setViewport(DOCUMENT_ID, start)
    runAction('view.panLeftFar', context())
    const far = Math.abs(
      (useAppStore.getState().viewports[DOCUMENT_ID]?.x ?? 0) - start.x,
    )
    expect(near).toBeGreaterThan(0)
    expect(far).toBeGreaterThan(near)
  })
})
