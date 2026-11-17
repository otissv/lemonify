import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  CANVAS_SELECTION,
  NO_SELECTION,
  stepSelection,
} from '@/features/workflows/workflow-selection'
import { RunCanvasMode } from '@/features/workflows/workflow'
import { resetStores } from '@/store/reset-stores'
import {
  MAX_RECENT_UPSCALE_MODELS,
  PREFERENCES_STORAGE_KEY,
  SidebarTab,
  Tool,
  useUiStore,
  workflowSelectionOf,
} from '@/store/ui-store'

const StoredPreferencesSchema = z.object({
  state: z.record(z.string(), z.unknown()),
})

const FIRST = '6f1c6c4e-0f43-4a8f-9a57-2d2f0f8f2b11'
const SECOND = '7a2d7d5f-1f54-4b9a-8b68-3e3a1a9a3c22'

describe('useUiStore', () => {
  beforeEach(() => {
    resetStores()
  })

  it('opens and closes the sidebar', () => {
    expect(useUiStore.getState().sidebarOpen).toBe(true)

    useUiStore.getState().setSidebarOpen(false)
    expect(useUiStore.getState().sidebarOpen).toBe(false)

    useUiStore.getState().setSidebarOpen(true)
    expect(useUiStore.getState().sidebarOpen).toBe(true)
  })

  it('starts with the panel at its default place on the Tools tab', () => {
    expect(useUiStore.getState().panelPosition).toBeNull()
    expect(useUiStore.getState().activeTool).toBe(Tool.Tools)
  })

  it('remembers where the panel was moved to', () => {
    useUiStore.getState().setPanelPosition({ x: 12, y: 34 })

    expect(useUiStore.getState().panelPosition).toEqual({ x: 12, y: 34 })
  })

  it('starts with the panel expanded and remembers when it is collapsed', () => {
    expect(useUiStore.getState().panelCollapsed).toBe(false)

    useUiStore.getState().setPanelCollapsed(true)

    expect(useUiStore.getState().panelCollapsed).toBe(true)
  })

  it('shows the original of a document only while asked to, and forgets it with the document', () => {
    const { setShowOriginal, forgetUi } = useUiStore.getState()
    expect(useUiStore.getState().showOriginal[FIRST]).toBeUndefined()

    setShowOriginal(FIRST, true)
    expect(useUiStore.getState().showOriginal[FIRST]).toBe(true)
    expect(useUiStore.getState().showOriginal[SECOND]).toBeUndefined()

    forgetUi(FIRST)
    expect(useUiStore.getState().showOriginal[FIRST]).toBeUndefined()
  })

  it('remembers the order documents and workflows were opened in, and forgets one that is closed or deleted', () => {
    const { visitItem, closeVisit, forgetUi } = useUiStore.getState()

    visitItem(FIRST)
    visitItem(SECOND)
    visitItem(FIRST)
    expect(useUiStore.getState().visitTrail).toEqual([SECOND, FIRST])

    closeVisit(FIRST)
    expect(useUiStore.getState().visitTrail).toEqual([SECOND])

    visitItem(FIRST)
    forgetUi(SECOND)
    expect(useUiStore.getState().visitTrail).toEqual([FIRST])
  })

  it('starts the sidebar on the Editor tab and switches tabs', () => {
    expect(useUiStore.getState().sidebarTab).toBe(SidebarTab.Editor)

    useUiStore.getState().setSidebarTab(SidebarTab.Workflow)

    expect(useUiStore.getState().sidebarTab).toBe(SidebarTab.Workflow)
  })

  describe('recent upscale models', () => {
    it('puts the latest model first without repeating models', () => {
      const { rememberUpscaleModel } = useUiStore.getState()

      rememberUpscaleModel('siax')
      rememberUpscaleModel('waifu')
      rememberUpscaleModel('siax')

      expect(useUiStore.getState().recentUpscaleModels).toEqual([
        'siax',
        'waifu',
      ])
    })

    it(`keeps the ${MAX_RECENT_UPSCALE_MODELS} most recent`, () => {
      const { rememberUpscaleModel } = useUiStore.getState()

      for (let index = 0; index < MAX_RECENT_UPSCALE_MODELS + 2; index += 1) {
        rememberUpscaleModel(`model-${index}`)
      }

      const recent = useUiStore.getState().recentUpscaleModels
      expect(recent).toHaveLength(MAX_RECENT_UPSCALE_MODELS)
      expect(recent.at(0)).toBe(`model-${MAX_RECENT_UPSCALE_MODELS + 1}`)
    })

    it('are kept in this browser, and nothing else is', async () => {
      await useUiStore.persist.rehydrate()
      useUiStore.getState().rememberUpscaleModel('waifu')

      const stored = StoredPreferencesSchema.parse(
        JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? 'null'),
      )
      expect(stored.state).toEqual({ recentUpscaleModels: ['waifu'] })
    })
  })

  describe('sidebar steps', () => {
    it('expands and collapses a document or workflow', () => {
      useUiStore.getState().setItemExpanded(FIRST, true)
      expect(useUiStore.getState().expandedItems[FIRST]).toBe(true)

      useUiStore.getState().setItemExpanded(FIRST, false)
      expect(useUiStore.getState().expandedItems[FIRST]).toBe(false)
    })

    it('selects a step, and clears the selection', () => {
      useUiStore.getState().selectStep(FIRST, 'step-1')
      expect(useUiStore.getState().selectedSteps[FIRST]).toBe('step-1')

      useUiStore.getState().selectStep(FIRST, undefined)
      expect(useUiStore.getState().selectedSteps[FIRST]).toBeUndefined()
    })

    it('picks several steps together, starting over when one is selected', () => {
      const store = useUiStore.getState()
      store.selectStep(FIRST, 'a')
      expect(useUiStore.getState().markedSteps[FIRST]).toEqual(['a'])

      store.markSteps(FIRST, ['a', 'b'])
      expect(useUiStore.getState().markedSteps[FIRST]).toEqual(['a', 'b'])

      store.selectStep(FIRST, 'c')
      expect(useUiStore.getState().markedSteps[FIRST]).toEqual(['c'])
      store.selectStep(FIRST, undefined)
      expect(useUiStore.getState().markedSteps[FIRST]).toEqual([])
    })

    it('remembers which groups are folded, without keeping it between visits', () => {
      useUiStore.getState().setGroupCollapsed('group-1', true)
      expect(useUiStore.getState().collapsedGroups['group-1']).toBe(true)
      useUiStore.getState().setGroupCollapsed('group-1', false)
      expect(useUiStore.getState().collapsedGroups['group-1']).toBe(false)
      expect(
        JSON.stringify(
          useUiStore.persist.getOptions().partialize?.(useUiStore.getState()),
        ),
      ).not.toContain('group-1')
    })
  })

  describe('what a workflow’s options show', () => {
    it('is nothing until something is chosen', () => {
      expect(workflowSelectionOf(useUiStore.getState(), FIRST)).toEqual(
        NO_SELECTION,
      )
    })

    it('is one thing at a time: a step, or the canvas, inputs or output', () => {
      const { selectInWorkflow } = useUiStore.getState()

      selectInWorkflow(FIRST, stepSelection('s1'))
      expect(workflowSelectionOf(useUiStore.getState(), FIRST)).toEqual(
        stepSelection('s1'),
      )
      expect(useUiStore.getState().markedSteps[FIRST]).toEqual(['s1'])

      selectInWorkflow(FIRST, CANVAS_SELECTION)
      expect(workflowSelectionOf(useUiStore.getState(), FIRST)).toEqual(
        CANVAS_SELECTION,
      )
      expect(useUiStore.getState().selectedSteps[FIRST]).toBeUndefined()
      expect(useUiStore.getState().markedSteps[FIRST]).toEqual([])

      selectInWorkflow(FIRST, NO_SELECTION)
      expect(workflowSelectionOf(useUiStore.getState(), FIRST)).toEqual(
        NO_SELECTION,
      )
    })

    it('gives way to a step selected another way, such as with the keyboard', () => {
      const { selectInWorkflow, selectStep } = useUiStore.getState()
      selectInWorkflow(FIRST, CANVAS_SELECTION)

      selectStep(FIRST, 's2')

      expect(workflowSelectionOf(useUiStore.getState(), FIRST)).toEqual(
        stepSelection('s2'),
      )
    })

    it('keeps the canvas of the next run for each workflow, and forgets it with the workflow', () => {
      const { setRunCanvasMode, forgetUi } = useUiStore.getState()

      setRunCanvasMode(FIRST, RunCanvasMode.FirstImage)
      expect(useUiStore.getState().runCanvasModes[FIRST]).toBe(
        RunCanvasMode.FirstImage,
      )
      expect(useUiStore.getState().runCanvasModes[SECOND]).toBeUndefined()

      forgetUi(FIRST)
      expect(useUiStore.getState().runCanvasModes[FIRST]).toBeUndefined()
    })
  })

  it('forgets everything the screen holds for a deleted document or workflow', () => {
    const store = useUiStore.getState()
    store.selectStep(FIRST, 'x')
    store.setItemExpanded(FIRST, true)
    store.selectInWorkflow(FIRST, CANVAS_SELECTION)
    store.selectStep(SECOND, 'y')

    store.forgetUi(FIRST)

    const state = useUiStore.getState()
    expect(state.selectedSteps[FIRST]).toBeUndefined()
    expect(state.markedSteps[FIRST]).toBeUndefined()
    expect(state.expandedItems[FIRST]).toBeUndefined()
    expect(state.workflowFocus[FIRST]).toBeUndefined()
    expect(state.selectedSteps[SECOND]).toBe('y')
  })
})
