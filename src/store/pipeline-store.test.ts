import { beforeEach, describe, expect, it } from 'vitest'

import { PreviewStatus } from '@/features/documents/document-render'
import { JobState } from '@/server/jobs/job-types'
import { createSharpStep } from '@/features/pipeline/pipeline'
import {
  currentPipeline,
  documentSession,
  usePipelineStore,
  workflowSession,
} from '@/store/pipeline-store'
import { resetStores } from '@/store/reset-stores'
import { documentView } from '@/test/document-fixtures'
import { workflowView } from '@/test/workflow-fixtures'

const FIRST = '6f1c6c4e-0f43-4a8f-9a57-2d2f0f8f2b11'
const SECOND = '7a2d7d5f-1f54-4b9a-8b68-3e3a1a9a3c22'
const FLOW = 'flow-1'

const blur = createSharpStep('blur')

describe('usePipelineStore', () => {
  beforeEach(() => {
    resetStores()
  })

  describe('previews and thumbnails', () => {
    it('keep each pipeline apart', () => {
      const store = usePipelineStore.getState()
      store.setPreview(FIRST, {
        status: PreviewStatus.Ready,
        key: 'a',
        pendingStepIds: [],
        waitingLayerIds: [],
        problems: [],
      })
      store.setThumbnails(SECOND, [{ stepId: 's', key: 'b' }])

      expect(usePipelineStore.getState().previews[FIRST]?.key).toBe('a')
      expect(usePipelineStore.getState().previews[SECOND]).toBeUndefined()
      expect(usePipelineStore.getState().thumbnails[SECOND]).toEqual([
        { stepId: 's', key: 'b' },
      ])
    })
  })

  describe('a picture that is out of date', () => {
    it('counts each time something its layers use changed, and forgets the count with the pipeline', () => {
      const store = usePipelineStore.getState()
      expect(usePipelineStore.getState().pictureVersions[FIRST]).toBeUndefined()

      store.pictureChanged(FIRST)
      store.pictureChanged(FIRST)
      store.pictureChanged(SECOND)

      expect(usePipelineStore.getState().pictureVersions[FIRST]).toBe(2)
      expect(usePipelineStore.getState().pictureVersions[SECOND]).toBe(1)

      store.forgetPipeline(FIRST)
      expect(usePipelineStore.getState().pictureVersions[FIRST]).toBeUndefined()
    })
  })

  describe('a document', () => {
    it('has nothing until the server has sent it', () => {
      expect(
        documentSession(usePipelineStore.getState(), FIRST),
      ).toBeUndefined()
      expect(
        currentPipeline(usePipelineStore.getState(), FIRST),
      ).toBeUndefined()
    })

    it('shows a queued change at once, before the server has confirmed it', () => {
      const store = usePipelineStore.getState()
      const opened = documentView([], FIRST).pipeline.steps
      store.confirmDocument(documentView([], FIRST), true)

      store.queueOperation(FIRST, {
        kind: 'change',
        change: { type: 'add-step', step: blur, index: opened.length },
      })

      expect(
        currentPipeline(usePipelineStore.getState(), FIRST)?.steps,
      ).toEqual([...opened, blur])
      expect(
        documentSession(usePipelineStore.getState(), FIRST)?.confirmed.pipeline
          .steps,
      ).toEqual(opened)
    })

    it('takes the server’s answer and drops the operation it answered', () => {
      const store = usePipelineStore.getState()
      store.confirmDocument(documentView([], FIRST), true)
      store.queueOperation(FIRST, {
        kind: 'change',
        change: { type: 'add-step', step: blur, index: 0 },
      })

      store.settleOperation({
        kind: 'document',
        view: { ...documentView([blur], FIRST), revision: 1 },
      })

      const session = documentSession(usePipelineStore.getState(), FIRST)
      expect(session?.pending).toEqual([])
      expect(session?.confirmed.revision).toBe(1)
    })

    it('keeps waiting operations when it is read again, unless reset', () => {
      const store = usePipelineStore.getState()
      store.confirmDocument(documentView([], FIRST), true)
      store.queueOperation(FIRST, { kind: 'undo' })

      store.confirmDocument(documentView([], FIRST), false)
      expect(usePipelineStore.getState().sessions[FIRST]?.pending).toHaveLength(
        1,
      )

      store.confirmDocument(documentView([], FIRST), true)
      expect(usePipelineStore.getState().sessions[FIRST]?.pending).toEqual([])
    })

    it('drops waiting operations when one fails, and keeps the reason until the next edit', () => {
      const store = usePipelineStore.getState()
      store.confirmDocument(documentView([], FIRST), true)
      store.queueOperation(FIRST, { kind: 'undo' })

      store.failSession(FIRST, 'Changed elsewhere.')
      expect(usePipelineStore.getState().sessions[FIRST]).toMatchObject({
        pending: [],
        error: 'Changed elsewhere.',
      })

      store.queueOperation(FIRST, { kind: 'redo' })
      expect(usePipelineStore.getState().sessions[FIRST]?.error).toBeUndefined()
    })

    it('keeps an error until it is cleared, and a rebase replaces the confirmed state', () => {
      const store = usePipelineStore.getState()
      store.confirmDocument(documentView([], FIRST), true)

      store.setSessionError(FIRST, 'Nope.')
      expect(usePipelineStore.getState().sessions[FIRST]?.error).toBe('Nope.')
      store.clearSessionError(FIRST)
      expect(usePipelineStore.getState().sessions[FIRST]?.error).toBeUndefined()

      store.rebaseSession(
        { kind: 'document', view: { ...documentView([], FIRST), revision: 5 } },
        [],
        'Some were dropped.',
      )
      expect(
        usePipelineStore.getState().sessions[FIRST]?.confirmed.revision,
      ).toBe(5)
      expect(usePipelineStore.getState().sessions[FIRST]?.error).toBe(
        'Some were dropped.',
      )
    })
  })

  describe('a workflow', () => {
    it('is held the same way, with its own kind', () => {
      const view = workflowView(FLOW)
      usePipelineStore.getState().confirmWorkflow(view, true)

      expect(
        workflowSession(usePipelineStore.getState(), FLOW)?.confirmed,
      ).toEqual(view)
      expect(documentSession(usePipelineStore.getState(), FLOW)).toBeUndefined()
      expect(currentPipeline(usePipelineStore.getState(), FLOW)?.steps).toEqual(
        view.pipeline.steps,
      )
    })

    it('shows a queued change, including one only a workflow has', () => {
      const store = usePipelineStore.getState()
      store.confirmWorkflow(workflowView(FLOW), true)

      store.queueOperation(FLOW, {
        kind: 'change',
        change: { type: 'set-inputs', sourceIds: ['a'] },
      })

      const session = workflowSession(usePipelineStore.getState(), FLOW)
      expect(session?.pending).toHaveLength(1)
    })

    it('ignores a confirmed state of the other kind', () => {
      const store = usePipelineStore.getState()
      store.confirmWorkflow(workflowView(FLOW), true)

      store.settleOperation({
        kind: 'document',
        view: { ...documentView([], FLOW), revision: 9 },
      })

      expect(
        workflowSession(usePipelineStore.getState(), FLOW)?.confirmed.revision,
      ).toBe(0)
    })
  })

  it('forgets everything held for a pipeline that was deleted, and nothing for another', () => {
    const store = usePipelineStore.getState()
    store.confirmDocument(documentView([], FIRST), true)
    store.confirmDocument(documentView([], SECOND, 'two.png'), true)
    store.setPreview(FIRST, {
      status: PreviewStatus.Ready,
      key: 'a',
      pendingStepIds: [],
      waitingLayerIds: [],
      problems: [],
    })
    store.setAiRun(FIRST, {
      jobId: 'j',
      stepId: 's',
      state: JobState.Running,
      progress: 0,
    })

    store.forgetPipeline(FIRST)

    const state = usePipelineStore.getState()
    expect(state.sessions[FIRST]).toBeUndefined()
    expect(state.previews[FIRST]).toBeUndefined()
    expect(state.aiRuns[FIRST]).toBeUndefined()
    expect(state.sessions[SECOND]).toBeDefined()
  })
})
