import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ImageOpener } from '@/features/app/image-opener'
import {
  applyEdit,
  redoEdit,
  undoEdit,
} from '@/features/pipeline/pipeline-sync'
import { canRunAction, runAction } from '@/features/keybindings/action-runner'
import type { ActionContext } from '@/features/keybindings/action-runner'
import { Page } from '@/features/keybindings/actions'
import { convertLayer } from '@/features/create-from/convert-layer'
import {
  createDocumentLayerStep,
  createWorkflowLayerStep,
} from '@/features/pipeline/layer-kinds'
import {
  createEmbeddedDocumentStep,
  createGroupStep,
  createSharpStep,
} from '@/features/pipeline/pipeline'
import { SidePanelTab, Tool, useUiStore } from '@/store/ui-store'
import {
  AI_CATALOGUES,
  DOCUMENT_ID,
  documentView,
  loadDocumentIntoEditor,
} from '@/test/document-fixtures'
import { usePipelineStore } from '@/store/pipeline-store'
import { resetStores } from '@/store/reset-stores'
import type { WorkflowView } from '@/server/services/workflow-service'
import { workflowView } from '@/test/workflow-fixtures'

vi.mock('@/features/pipeline/pipeline-sync', () => ({
  applyEdit: vi.fn().mockResolvedValue(undefined),
  loadDocument: vi.fn().mockResolvedValue(undefined),
  undoEdit: vi.fn().mockResolvedValue(undefined),
  redoEdit: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/features/create-from/convert-layer', () => ({
  convertLayer: vi.fn().mockResolvedValue(undefined),
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
    page: Page.Document,
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
  resetStores()
})

describe('actions on a page with no document', () => {
  it('open and import images, show the library, the sidebar and the shortcuts', () => {
    const page = context({ page: Page.Home, documentId: undefined })
    expect(runAction('file.openImage', page)).toBe(true)
    expect(runAction('file.openLibrary', page)).toBe(true)
    expect(runAction('file.importDocument', page)).toBe(true)
    expect(page.opener.openImage).toHaveBeenCalled()
    expect(page.opener.openLibraryImage).toHaveBeenCalled()
    expect(page.opener.importDocument).toHaveBeenCalled()

    expect(useUiStore.getState().sidebarOpen).toBe(true)
    runAction('view.sidebar', page)
    expect(useUiStore.getState().sidebarOpen).toBe(false)
    runAction('help.shortcuts', page)
    expect(useUiStore.getState().shortcutsOpen).toBe(true)
    runAction('help.shortcuts', page)
    expect(useUiStore.getState().shortcutsOpen).toBe(false)
  })

  it('open the New document dialog, with or without a document open', () => {
    const page = context({ page: Page.Home, documentId: undefined })
    expect(canRunAction('file.newDocument', page)).toBe(true)

    expect(runAction('file.newDocument', page)).toBe(true)
    expect(useUiStore.getState().newDocumentOpen).toBe(true)

    useUiStore.getState().setNewDocumentOpen(false)
    loadDocumentIntoEditor(documentView())
    expect(runAction('file.newDocument', context())).toBe(true)
    expect(useUiStore.getState().newDocumentOpen).toBe(true)
  })

  it('do nothing that needs a document', () => {
    const page = context({ page: Page.Home, documentId: undefined })
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
      page: Page.Home,
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
    expect(useUiStore.getState().showOriginal[DOCUMENT_ID]).toBe(true)
    runAction('edit.showOriginal', context())
    expect(useUiStore.getState().showOriginal[DOCUMENT_ID]).toBe(false)
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
      runAction(
        'edit.addImageLayer',
        context({ page: Page.Home, documentId: undefined }),
      ),
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

describe('the page an action is done on', () => {
  it('does only the actions that apply on it', () => {
    loadDocumentIntoEditor(documentView())
    const onDocument = context()
    const onWorkflow = context({ page: Page.Workflow })

    expect(canRunAction('edit.insertImage', onDocument)).toBe(true)
    expect(canRunAction('edit.insertImage', onWorkflow)).toBe(false)
    expect(runAction('panel.navigator', onWorkflow)).toBe(false)
    expect(runAction('view.stepPreview', onDocument)).toBe(false)
    expect(
      canRunAction(
        'help.shortcuts',
        context({ page: Page.Home, documentId: undefined }),
      ),
    ).toBe(true)
  })

  it('opens the canvas size of a document in its Document panel', () => {
    loadDocumentIntoEditor(documentView())

    expect(runAction('edit.setCanvas', context())).toBe(true)

    expect(useUiStore.getState().activeTool).toBe(Tool.Document)
  })
})

describe('actions on a workflow, which is a pipeline with an Edit history', () => {
  const WORKFLOW_ID = 'w1'

  function openWorkflow(canUndo = false, canRedo = false): WorkflowView {
    const view = { ...workflowView(WORKFLOW_ID), canUndo, canRedo }
    usePipelineStore.getState().confirmWorkflow(view, true)
    return view
  }

  it('show and hide the step preview, which only a workflow has', () => {
    openWorkflow()
    const workflow = context({ page: Page.Workflow, documentId: WORKFLOW_ID })

    expect(useUiStore.getState().workflowSidePanelOpen).toBe(true)
    expect(runAction('view.stepPreview', workflow)).toBe(true)
    expect(useUiStore.getState().workflowSidePanelOpen).toBe(false)
    runAction('view.stepPreview', workflow)
    expect(useUiStore.getState().workflowSidePanelOpen).toBe(true)

    loadDocumentIntoEditor(documentView())
    expect(canRunAction('view.stepPreview', context())).toBe(false)
    expect(
      canRunAction(
        'view.stepPreview',
        context({ page: Page.Home, documentId: undefined }),
      ),
    ).toBe(false)
  })

  it('show the run panel, switch the side panel between its tabs, and hide it from the tab it shows', () => {
    openWorkflow()
    const workflow = context({ page: Page.Workflow, documentId: WORKFLOW_ID })
    const panel = (): [boolean, SidePanelTab] => {
      const state = useUiStore.getState()
      return [state.workflowSidePanelOpen, state.workflowSidePanelTab]
    }

    expect(runAction('view.runPanel', workflow)).toBe(true)
    expect(panel()).toEqual([true, SidePanelTab.Runs])
    runAction('view.stepPreview', workflow)
    expect(panel()).toEqual([true, SidePanelTab.Preview])
    runAction('view.stepPreview', workflow)
    expect(panel()).toEqual([false, SidePanelTab.Preview])
    runAction('view.runPanel', workflow)
    expect(panel()).toEqual([true, SidePanelTab.Runs])
    expect(canRunAction('view.runPanel', context())).toBe(false)
  })

  it('open the canvas size of a workflow by selecting its Canvas', () => {
    openWorkflow()
    const workflow = context({ page: Page.Workflow, documentId: WORKFLOW_ID })

    expect(runAction('edit.setCanvas', workflow)).toBe(true)

    expect(useUiStore.getState().workflowFocus[WORKFLOW_ID]).toBe('canvas')
    expect(useUiStore.getState().activeTool).toBe(Tool.Options)
  })

  it('undo and redo only when its Edit history has something to undo or redo', () => {
    openWorkflow(true, false)
    const workflow = context({ page: Page.Workflow, documentId: WORKFLOW_ID })

    expect(canRunAction('edit.undo', workflow)).toBe(true)
    expect(canRunAction('edit.redo', workflow)).toBe(false)

    runAction('edit.undo', workflow)

    expect(undoEdit).toHaveBeenCalledWith(WORKFLOW_ID)
  })

  it('edit its steps with the same keys as a document’s', () => {
    const [layer] = openWorkflow().pipeline.steps
    useUiStore.getState().selectStep(WORKFLOW_ID, layer?.id)
    const workflow = context({ page: Page.Workflow, documentId: WORKFLOW_ID })

    expect(canRunAction('step.delete', workflow)).toBe(true)
    runAction('step.delete', workflow)

    expect(applyEdit).toHaveBeenCalledWith(WORKFLOW_ID, {
      type: 'remove-step',
      stepId: layer?.id,
    })
  })

  it('do not export, replace an image or show an original, which are about a document', () => {
    openWorkflow()
    const workflow = context({ page: Page.Workflow, documentId: WORKFLOW_ID })

    for (const id of [
      'file.exportImage',
      'file.exportDocument',
      'edit.replaceImage',
      'edit.showOriginal',
    ]) {
      expect(canRunAction(id, workflow), id).toBe(false)
    }
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
    expect(useUiStore.getState().activeTool).toBe(Tool.Export)
    runAction('panel.navigator', page)
    expect(useUiStore.getState().activeTool).toBe(Tool.Navigator)
    runAction('panel.results', page)
    expect(useUiStore.getState().activeTool).toBe(Tool.Results)
  })
})

describe('step actions', () => {
  function select(id: string | undefined): void {
    useUiStore.getState().selectStep(DOCUMENT_ID, id)
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
    const first = useUiStore.getState().selectedSteps[DOCUMENT_ID]
    select(undefined)
    runAction('step.selectUp', context())
    expect(useUiStore.getState().selectedSteps[DOCUMENT_ID]).toBe(rotate.id)
    runAction('step.selectUp', context())
    expect(useUiStore.getState().selectedSteps[DOCUMENT_ID]).toBe(flip.id)
    expect(first).toBeDefined()
  })

  it('group the picked steps, and say why when they cannot be grouped', () => {
    useUiStore.getState().markSteps(DOCUMENT_ID, [blur.id, flip.id])
    expect(runAction('step.group', context())).toBe(true)
    expect(applyEdit).toHaveBeenLastCalledWith(
      DOCUMENT_ID,
      expect.objectContaining({ type: 'group-steps' }),
    )
    useUiStore.getState().markSteps(DOCUMENT_ID, [blur.id, rotate.id])
    expect(runAction('step.group', context())).toBe(false)
  })

  it('ungroup the selected group', () => {
    const group = createGroupStep([blur, flip])
    loadDocumentIntoEditor(documentView([group, rotate]))
    select(group.id)
    expect(runAction('step.ungroup', context())).toBe(true)
    expect(applyEdit).toHaveBeenLastCalledWith(DOCUMENT_ID, {
      type: 'ungroup',
      stepId: group.id,
    })
    select(rotate.id)
    expect(canRunAction('step.ungroup', context())).toBe(false)
  })
})

describe('tool actions', () => {
  beforeEach(() => {
    loadDocumentIntoEditor(documentView([createSharpStep('blur')]))
  })

  it('move, select and ungroup steps at any depth, inside embedded document layers too', () => {
    const inner = createGroupStep([blur, flip])
    const embedded = createEmbeddedDocumentStep([inner])
    loadDocumentIntoEditor(documentView([embedded, rotate]))

    useUiStore.getState().selectStep(DOCUMENT_ID, flip.id)
    expect(canRunAction('step.moveDown', context())).toBe(false)
    expect(runAction('step.moveUp', context())).toBe(true)
    expect(applyEdit).toHaveBeenLastCalledWith(
      DOCUMENT_ID,
      expect.objectContaining({
        type: 'move-step',
        stepId: flip.id,
        to: 0,
        parentId: inner.id,
      }),
    )

    useUiStore.getState().selectStep(DOCUMENT_ID, embedded.id)
    runAction('step.selectDown', context())
    expect(useUiStore.getState().selectedSteps[DOCUMENT_ID]).toBe(inner.id)
    runAction('step.selectDown', context())
    expect(useUiStore.getState().selectedSteps[DOCUMENT_ID]).toBe(blur.id)

    useUiStore.getState().selectStep(DOCUMENT_ID, embedded.id)
    expect(runAction('step.ungroup', context())).toBe(true)
    expect(applyEdit).toHaveBeenLastCalledWith(DOCUMENT_ID, {
      type: 'ungroup',
      stepId: embedded.id,
    })
  })

  it('add a Sharp tool as a step after the selected one', () => {
    expect(runAction('tool.sharp.blur', context())).toBe(true)
    expect(applyEdit).toHaveBeenCalledWith(
      DOCUMENT_ID,
      expect.objectContaining({
        type: 'add-step',
        step: expect.objectContaining({ op: 'blur' }),
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
    useUiStore.getState().setViewFrame(DOCUMENT_ID, {
      viewWidth: 400,
      viewHeight: 300,
      pictureWidth: 1000,
      pictureHeight: 1000,
    })
    expect(runAction('view.zoomIn', context())).toBe(true)
    // 1000 x 1000 in a 400 x 300 window opens fitted, at 30%.
    expect(useUiStore.getState().viewports[DOCUMENT_ID]?.zoom).toBeGreaterThan(
      0.3,
    )
  })

  it('pan further for the far keys', () => {
    loadDocumentIntoEditor(documentView())
    useUiStore.getState().setViewFrame(DOCUMENT_ID, {
      viewWidth: 400,
      viewHeight: 300,
      pictureWidth: 1000,
      pictureHeight: 1000,
    })
    for (let step = 0; step < 4; step += 1) runAction('view.zoomIn', context())
    const start = useUiStore.getState().viewports[DOCUMENT_ID]
    if (start === undefined) throw new Error('no viewport')
    runAction('view.panLeft', context())
    const near = Math.abs(
      (useUiStore.getState().viewports[DOCUMENT_ID]?.x ?? 0) - start.x,
    )
    useUiStore.getState().setViewport(DOCUMENT_ID, start)
    runAction('view.panLeftFar', context())
    const far = Math.abs(
      (useUiStore.getState().viewports[DOCUMENT_ID]?.x ?? 0) - start.x,
    )
    expect(near).toBeGreaterThan(0)
    expect(far).toBeGreaterThan(near)
  })
})

describe('making a new item from the one on screen', () => {
  const WORKFLOW_ID = 'w1'

  it('open the new workflow dialog for the document, or for its selected group or embedded document layer', () => {
    const group = createGroupStep([blur])
    loadDocumentIntoEditor(documentView([group, flip]))

    expect(runAction('file.newWorkflowFromDocument', context())).toBe(true)
    expect(useUiStore.getState().createFrom).toEqual({
      kind: 'workflow-from-document',
      documentId: DOCUMENT_ID,
    })

    useUiStore.getState().selectStep(DOCUMENT_ID, group.id)
    runAction('file.newWorkflowFromDocument', context())
    expect(useUiStore.getState().createFrom).toEqual({
      kind: 'workflow-from-document',
      documentId: DOCUMENT_ID,
      stepId: group.id,
    })

    useUiStore.getState().selectStep(DOCUMENT_ID, flip.id)
    runAction('file.newWorkflowFromDocument', context())
    expect(useUiStore.getState().createFrom).toEqual({
      kind: 'workflow-from-document',
      documentId: DOCUMENT_ID,
    })
  })

  it('open the new document dialog for the workflow, only on a workflow’s page', () => {
    usePipelineStore.getState().confirmWorkflow(workflowView(WORKFLOW_ID), true)
    const workflow = context({ page: Page.Workflow, documentId: WORKFLOW_ID })

    expect(runAction('file.newDocumentFromWorkflow', workflow)).toBe(true)
    expect(useUiStore.getState().createFrom).toEqual({
      kind: 'document-from-workflow',
      workflowId: WORKFLOW_ID,
    })
    expect(canRunAction('file.newWorkflowFromDocument', workflow)).toBe(false)

    loadDocumentIntoEditor(documentView())
    expect(canRunAction('file.newDocumentFromWorkflow', context())).toBe(false)
    expect(
      canRunAction(
        'file.newWorkflowFromDocument',
        context({ page: Page.Home, documentId: undefined }),
      ),
    ).toBe(false)
  })
})

describe('a new item from a selected document or workflow layer', () => {
  it('makes a workflow from the document a selected document layer uses, on any page', () => {
    const layer = createDocumentLayerStep('d2')
    loadDocumentIntoEditor(documentView([layer]))
    useUiStore.getState().selectStep(DOCUMENT_ID, layer.id)

    runAction('file.newWorkflowFromDocument', context())

    expect(useUiStore.getState().createFrom).toEqual({
      kind: 'workflow-from-document',
      documentId: 'd2',
    })
  })

  it('makes a document from the workflow a selected workflow layer uses, with the layer’s image, even in a document', () => {
    const layer = createWorkflowLayerStep('w2', 'src-logo')
    const empty = createWorkflowLayerStep('w3')
    loadDocumentIntoEditor(documentView([layer, empty]))
    useUiStore.getState().selectStep(DOCUMENT_ID, layer.id)

    expect(runAction('file.newDocumentFromWorkflow', context())).toBe(true)
    expect(useUiStore.getState().createFrom).toEqual({
      kind: 'document-from-workflow',
      workflowId: 'w2',
      inputImage: 'src-logo',
    })

    useUiStore.getState().selectStep(DOCUMENT_ID, empty.id)
    runAction('file.newDocumentFromWorkflow', context())
    expect(useUiStore.getState().createFrom).toMatchObject({
      inputImage: null,
    })
  })
})

describe('converting the selected layer', () => {
  it('converts a selected document layer, and is off for any other step', () => {
    const layer = createDocumentLayerStep('d2')
    loadDocumentIntoEditor(documentView([blur, layer]))

    useUiStore.getState().selectStep(DOCUMENT_ID, blur.id)
    expect(canRunAction('step.convertToEmbedded', context())).toBe(false)

    useUiStore.getState().selectStep(DOCUMENT_ID, layer.id)
    expect(runAction('step.convertToEmbedded', context())).toBe(true)
    expect(convertLayer).toHaveBeenCalledWith(DOCUMENT_ID, layer.id)
  })
})

describe('adding a document or workflow layer', () => {
  it('opens the picker for the kind, to add it after the selected step', () => {
    loadDocumentIntoEditor(documentView([blur, flip]))

    expect(runAction('edit.addDocumentLayer', context())).toBe(true)
    expect(useUiStore.getState().createFrom).toEqual({
      kind: 'add-used-layer',
      itemId: DOCUMENT_ID,
      layer: 'document',
    })

    useUiStore.getState().selectStep(DOCUMENT_ID, blur.id)
    runAction('edit.addWorkflowLayer', context())
    expect(useUiStore.getState().createFrom).toEqual({
      kind: 'add-used-layer',
      itemId: DOCUMENT_ID,
      layer: 'workflow',
      afterStepId: blur.id,
    })
  })

  it('opens the picker on a workflow’s page too', () => {
    const WORKFLOW_ID = 'w1'
    usePipelineStore.getState().confirmWorkflow(workflowView(WORKFLOW_ID), true)
    const workflow = context({ page: Page.Workflow, documentId: WORKFLOW_ID })

    expect(runAction('edit.addDocumentLayer', workflow)).toBe(true)
    expect(useUiStore.getState().createFrom).toEqual({
      kind: 'add-used-layer',
      itemId: WORKFLOW_ID,
      layer: 'document',
    })
  })
})

describe('adding a workflow to the document', () => {
  it('opens the insert workflow dialog, to add it after the selected step', () => {
    loadDocumentIntoEditor(documentView([blur, flip]))

    expect(runAction('edit.insertWorkflow', context())).toBe(true)
    expect(useUiStore.getState().createFrom).toEqual({
      kind: 'insert-workflow',
      documentId: DOCUMENT_ID,
    })

    useUiStore.getState().selectStep(DOCUMENT_ID, blur.id)
    runAction('edit.insertWorkflow', context())
    expect(useUiStore.getState().createFrom).toEqual({
      kind: 'insert-workflow',
      documentId: DOCUMENT_ID,
      afterStepId: blur.id,
    })
  })
})
