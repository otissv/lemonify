import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { PreviewStatus } from '@/features/documents/document-render'
import { createSharpStep } from '@/features/pipeline/pipeline'
import {
  INITIAL_APP_STATE,
  MAX_RECENT_UPSCALE_MODELS,
  PREFERENCES_STORAGE_KEY,
  SidebarTab,
  Tool,
  currentPipeline,
  useAppStore,
} from '@/store/app-store'
import { documentView } from '@/test/document-fixtures'

const StoredPreferencesSchema = z.object({
  state: z.record(z.string(), z.unknown()),
})

const FIRST = '6f1c6c4e-0f43-4a8f-9a57-2d2f0f8f2b11'
const SECOND = '7a2d7d5f-1f54-4b9a-8b68-3e3a1a9a3c22'

describe('useAppStore', () => {
  beforeEach(() => {
    useAppStore.setState(INITIAL_APP_STATE)
  })

  it('opens and closes the sidebar', () => {
    expect(useAppStore.getState().sidebarOpen).toBe(true)

    useAppStore.getState().setSidebarOpen(false)
    expect(useAppStore.getState().sidebarOpen).toBe(false)

    useAppStore.getState().setSidebarOpen(true)
    expect(useAppStore.getState().sidebarOpen).toBe(true)
  })

  it('starts with the panel at its default place on the Tools tab', () => {
    expect(useAppStore.getState().panelPosition).toBeNull()
    expect(useAppStore.getState().activeTool).toBe(Tool.Tools)
  })

  it('remembers where the panel was moved to', () => {
    useAppStore.getState().setPanelPosition({ x: 12, y: 34 })

    expect(useAppStore.getState().panelPosition).toEqual({ x: 12, y: 34 })
  })

  it('starts with the panel expanded and remembers when it is collapsed', () => {
    expect(useAppStore.getState().panelCollapsed).toBe(false)

    useAppStore.getState().setPanelCollapsed(true)

    expect(useAppStore.getState().panelCollapsed).toBe(true)
  })

  it('shows the original of a document only while asked to, and forgets it with the document', () => {
    const { setShowOriginal, forgetDocument } = useAppStore.getState()
    expect(useAppStore.getState().showOriginal[FIRST]).toBeUndefined()

    setShowOriginal(FIRST, true)
    expect(useAppStore.getState().showOriginal[FIRST]).toBe(true)
    expect(useAppStore.getState().showOriginal[SECOND]).toBeUndefined()

    forgetDocument(FIRST)
    expect(useAppStore.getState().showOriginal[FIRST]).toBeUndefined()
  })

  it('remembers the order documents were opened in, and forgets one that is closed or deleted', () => {
    const { visitDocument, closeDocumentVisit, forgetDocument } =
      useAppStore.getState()

    visitDocument(FIRST)
    visitDocument(SECOND)
    visitDocument(FIRST)
    expect(useAppStore.getState().documentHistory).toEqual([SECOND, FIRST])

    closeDocumentVisit(FIRST)
    expect(useAppStore.getState().documentHistory).toEqual([SECOND])

    visitDocument(FIRST)
    forgetDocument(SECOND)
    expect(useAppStore.getState().documentHistory).toEqual([FIRST])
  })

  it('starts the sidebar on the Editor tab and switches tabs', () => {
    expect(useAppStore.getState().sidebarTab).toBe(SidebarTab.Editor)

    useAppStore.getState().setSidebarTab(SidebarTab.Workflow)

    expect(useAppStore.getState().sidebarTab).toBe(SidebarTab.Workflow)
  })

  describe('recent upscale models', () => {
    it('puts the latest model first without repeating models', () => {
      const { rememberUpscaleModel } = useAppStore.getState()

      rememberUpscaleModel('siax')
      rememberUpscaleModel('waifu')
      rememberUpscaleModel('siax')

      expect(useAppStore.getState().recentUpscaleModels).toEqual([
        'siax',
        'waifu',
      ])
    })

    it(`keeps the ${MAX_RECENT_UPSCALE_MODELS} most recent`, () => {
      const { rememberUpscaleModel } = useAppStore.getState()

      for (let index = 0; index < MAX_RECENT_UPSCALE_MODELS + 2; index += 1) {
        rememberUpscaleModel(`model-${index}`)
      }

      const recent = useAppStore.getState().recentUpscaleModels
      expect(recent).toHaveLength(MAX_RECENT_UPSCALE_MODELS)
      expect(recent.at(0)).toBe(`model-${MAX_RECENT_UPSCALE_MODELS + 1}`)
    })

    it('are kept in this browser, and nothing else is', async () => {
      await useAppStore.persist.rehydrate()
      useAppStore.getState().rememberUpscaleModel('waifu')

      const stored = StoredPreferencesSchema.parse(
        JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? 'null'),
      )
      expect(stored.state).toEqual({ recentUpscaleModels: ['waifu'] })
    })
  })

  describe('previews and thumbnails', () => {
    it('keep each document apart', () => {
      const store = useAppStore.getState()
      store.setPreview(FIRST, {
        status: PreviewStatus.Ready,
        key: 'a',
        pendingStepIds: [],
        problems: [],
      })
      store.setThumbnails(SECOND, [{ stepId: 's', key: 'b' }])

      expect(useAppStore.getState().previews[FIRST]?.key).toBe('a')
      expect(useAppStore.getState().previews[SECOND]).toBeUndefined()
      expect(useAppStore.getState().thumbnails[SECOND]).toEqual([
        { stepId: 's', key: 'b' },
      ])
    })
  })

  describe('sidebar steps', () => {
    it('expands and collapses a document', () => {
      useAppStore.getState().setDocumentExpanded(FIRST, true)
      expect(useAppStore.getState().expandedDocuments[FIRST]).toBe(true)

      useAppStore.getState().setDocumentExpanded(FIRST, false)
      expect(useAppStore.getState().expandedDocuments[FIRST]).toBe(false)
    })

    it('selects a step of a document, and clears the selection', () => {
      useAppStore.getState().selectStep(FIRST, 'step-1')
      expect(useAppStore.getState().selectedSteps[FIRST]).toBe('step-1')

      useAppStore.getState().selectStep(FIRST, undefined)
      expect(useAppStore.getState().selectedSteps[FIRST]).toBeUndefined()
    })

    it('picks several steps together, starting over when one is selected', () => {
      const store = useAppStore.getState()
      store.selectStep(FIRST, 'a')
      expect(useAppStore.getState().markedSteps[FIRST]).toEqual(['a'])

      store.markSteps(FIRST, ['a', 'b'])
      expect(useAppStore.getState().markedSteps[FIRST]).toEqual(['a', 'b'])

      store.selectStep(FIRST, 'c')
      expect(useAppStore.getState().markedSteps[FIRST]).toEqual(['c'])
      store.selectStep(FIRST, undefined)
      expect(useAppStore.getState().markedSteps[FIRST]).toEqual([])
    })

    it('remembers which groups are folded, without keeping it between visits', () => {
      useAppStore.getState().setGroupCollapsed('group-1', true)
      expect(useAppStore.getState().collapsedGroups['group-1']).toBe(true)
      useAppStore.getState().setGroupCollapsed('group-1', false)
      expect(useAppStore.getState().collapsedGroups['group-1']).toBe(false)
      expect(
        JSON.stringify(
          useAppStore.persist.getOptions().partialize?.(useAppStore.getState()),
        ),
      ).not.toContain('group-1')
    })
  })

  describe('documents', () => {
    const blur = createSharpStep('blur')

    it('has nothing for a document until the server has sent it', () => {
      expect(useAppStore.getState().documents[FIRST]).toBeUndefined()
      expect(currentPipeline(useAppStore.getState(), FIRST)).toBeUndefined()
    })

    it('shows a queued change at once, before the server has confirmed it', () => {
      const store = useAppStore.getState()
      const opened = documentView([], FIRST).pipeline.steps
      store.confirmDocument(documentView([], FIRST), true)

      store.queueOperation(FIRST, {
        kind: 'change',
        change: { type: 'add-step', step: blur, index: opened.length },
      })

      expect(currentPipeline(useAppStore.getState(), FIRST)?.steps).toEqual([
        ...opened,
        blur,
      ])
      expect(
        useAppStore.getState().documents[FIRST]?.confirmed.pipeline.steps,
      ).toEqual(opened)
    })

    it('takes the server’s answer and drops the operation it answered', () => {
      const store = useAppStore.getState()
      store.confirmDocument(documentView([], FIRST), true)
      store.queueOperation(FIRST, {
        kind: 'change',
        change: { type: 'add-step', step: blur, index: 0 },
      })

      store.settleOperation({ ...documentView([blur], FIRST), revision: 1 })

      const session = useAppStore.getState().documents[FIRST]
      expect(session?.pending).toEqual([])
      expect(session?.confirmed.revision).toBe(1)
    })

    it('keeps waiting operations when the document is read again, unless reset', () => {
      const store = useAppStore.getState()
      store.confirmDocument(documentView([], FIRST), true)
      store.queueOperation(FIRST, { kind: 'undo' })

      store.confirmDocument(documentView([], FIRST), false)
      expect(useAppStore.getState().documents[FIRST]?.pending).toHaveLength(1)

      store.confirmDocument(documentView([], FIRST), true)
      expect(useAppStore.getState().documents[FIRST]?.pending).toEqual([])
    })

    it('drops waiting operations when one fails, and keeps the reason until the next edit', () => {
      const store = useAppStore.getState()
      store.confirmDocument(documentView([], FIRST), true)
      store.queueOperation(FIRST, { kind: 'undo' })

      store.failDocument(FIRST, 'Changed elsewhere.')
      expect(useAppStore.getState().documents[FIRST]).toMatchObject({
        pending: [],
        error: 'Changed elsewhere.',
      })

      store.queueOperation(FIRST, { kind: 'redo' })
      expect(useAppStore.getState().documents[FIRST]?.error).toBeUndefined()
    })

    it('forgets everything held for a document that was deleted', () => {
      const store = useAppStore.getState()
      store.confirmDocument(documentView([], FIRST), true)
      store.selectStep(FIRST, 'x')
      store.setDocumentExpanded(FIRST, true)
      store.confirmDocument(documentView([], SECOND, 'two.png'), true)

      store.forgetDocument(FIRST)

      const state = useAppStore.getState()
      expect(state.documents[FIRST]).toBeUndefined()
      expect(state.selectedSteps[FIRST]).toBeUndefined()
      expect(state.markedSteps[FIRST]).toBeUndefined()
      expect(state.expandedDocuments[FIRST]).toBeUndefined()
      expect(state.documents[SECOND]).toBeDefined()
    })
  })
})
