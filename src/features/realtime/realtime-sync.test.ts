import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { reconcilePipeline } from '@/features/pipeline/pipeline-sync'
import {
  DELETED_NOTICE,
  createListRefresher,
  createRealtimeSync,
} from '@/features/realtime/realtime-sync'
import { useLibraryStore } from '@/store/library-store'
import { useUiStore } from '@/store/ui-store'
import { documentSession, usePipelineStore } from '@/store/pipeline-store'
import { DOCUMENT_ID, documentView } from '@/test/document-fixtures'
import { workflowView } from '@/test/workflow-fixtures'
import { resetStores } from '@/store/reset-stores'

vi.mock('@/features/pipeline/pipeline-sync', () => ({
  reconcilePipeline: vi.fn(),
}))

const realRefreshResults = useLibraryStore.getState().refreshResults
const refreshResults = vi.fn()

beforeEach(() => {
  resetStores()
  refreshResults.mockResolvedValue(undefined)
  useLibraryStore.setState({ refreshResults })
  vi.mocked(reconcilePipeline).mockResolvedValue(undefined)
})

afterEach(() => {
  useLibraryStore.setState({ refreshResults: realRefreshResults })
  vi.resetAllMocks()
})

describe('createListRefresher', () => {
  it('reads the lists again', async () => {
    const invalidate = vi.fn().mockResolvedValue(undefined)

    await createListRefresher(invalidate).request()

    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it('reads once more, not many times, when asked while it is reading', async () => {
    let finish: () => void = () => undefined
    const invalidate = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (finish = resolve)),
      )
      .mockResolvedValue(undefined)
    const refresher = createListRefresher(invalidate)

    const first = refresher.request()
    void refresher.request()
    void refresher.request()
    finish()
    await first

    expect(invalidate).toHaveBeenCalledTimes(2)
  })

  it('keeps going after a failed read', async () => {
    const invalidate = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined)
    const refresher = createListRefresher(invalidate)

    await refresher.request()
    await refresher.request()

    expect(invalidate).toHaveBeenCalledTimes(2)
  })
})

describe('createRealtimeSync', () => {
  function make(open?: string) {
    const invalidate = vi.fn().mockResolvedValue(undefined)
    const leaveDocument = vi.fn()
    const sync = createRealtimeSync({
      invalidate,
      openItemId: () => open,
      leaveItem: leaveDocument,
    })
    return { sync, invalidate, leaveDocument }
  }

  it('reads the lists again when documents or workflows change', async () => {
    const { sync, invalidate } = make()

    sync.handle({ type: 'documents.changed' })
    sync.handle({ type: 'workflows.changed' })
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled())
  })

  it('brings an updated document up to date', () => {
    const { sync } = make()

    sync.handle({
      type: 'document.updated',
      documentId: 'd1',
      revision: 4,
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    expect(reconcilePipeline).toHaveBeenCalledWith('d1', {
      revision: 4,
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('does not stop on a document that could not be read', async () => {
    vi.mocked(reconcilePipeline).mockRejectedValue(new Error('offline'))
    const { sync } = make()

    expect(() =>
      sync.handle({
        type: 'document.updated',
        documentId: 'd1',
        revision: 1,
        updatedAt: 'x',
      }),
    ).not.toThrow()
    await Promise.resolve()
  })

  it('makes lists of results read again', () => {
    const { sync } = make()

    sync.handle({ type: 'results.changed' })

    expect(refreshResults).toHaveBeenCalledTimes(1)
  })

  it('marks the picture of a document or workflow out of date when something its layers use changed', () => {
    const { sync, invalidate } = make()

    sync.handle({ type: 'picture.changed', itemId: 'd1' })

    expect(usePipelineStore.getState().pictureVersions.d1).toBe(1)
    expect(invalidate).not.toHaveBeenCalled()
    expect(reconcilePipeline).not.toHaveBeenCalled()
  })

  it('does nothing for a heartbeat', () => {
    const { sync, invalidate } = make()

    sync.handle({ type: 'heartbeat' })

    expect(invalidate).not.toHaveBeenCalled()
    expect(refreshResults).not.toHaveBeenCalled()
  })

  describe('a document deleted elsewhere', () => {
    it('is forgotten here, and the person is told if they had it open', () => {
      usePipelineStore.getState().confirmDocument(documentView(), true)
      const { sync, leaveDocument } = make(DOCUMENT_ID)

      sync.handle({ type: 'document.deleted', documentId: DOCUMENT_ID })

      expect(
        documentSession(usePipelineStore.getState(), DOCUMENT_ID),
      ).toBeUndefined()
      expect(leaveDocument).toHaveBeenCalled()
      expect(useUiStore.getState().liveNotice).toBe(DELETED_NOTICE)
    })

    it('is forgotten quietly when it was not the one open', () => {
      usePipelineStore.getState().confirmDocument(documentView(), true)
      const { sync, leaveDocument } = make('another')

      sync.handle({ type: 'document.deleted', documentId: DOCUMENT_ID })

      expect(
        documentSession(usePipelineStore.getState(), DOCUMENT_ID),
      ).toBeUndefined()
      expect(leaveDocument).not.toHaveBeenCalled()
      expect(useUiStore.getState().liveNotice).toBeUndefined()
    })
  })

  describe('a workflow', () => {
    it('is reconciled when another tab changed it', () => {
      const { sync } = make()

      sync.handle({
        type: 'workflow.updated',
        workflowId: 'w1',
        revision: 4,
        updatedAt: '2026-01-01T00:00:00.000Z',
      })

      expect(reconcilePipeline).toHaveBeenCalledWith('w1', {
        revision: 4,
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
    })

    it('is forgotten when deleted elsewhere, and the person is told if they had it open', () => {
      usePipelineStore.getState().confirmWorkflow(workflowView('w1'), true)
      useLibraryStore.setState({ runs: { w1: [] } })
      const { sync, leaveDocument } = make('w1')

      sync.handle({ type: 'workflow.deleted', workflowId: 'w1' })

      expect(usePipelineStore.getState().sessions.w1).toBeUndefined()
      expect(useLibraryStore.getState().runs.w1).toBeUndefined()
      expect(leaveDocument).toHaveBeenCalled()
      expect(useUiStore.getState().liveNotice).toBe(DELETED_NOTICE)
    })
  })

  describe('catching up', () => {
    it('reads the lists and every open document, as nothing is known of what was missed', async () => {
      usePipelineStore.getState().confirmDocument(documentView(), true)
      const { sync, invalidate } = make()

      await sync.catchUp()

      expect(invalidate).toHaveBeenCalled()
      expect(reconcilePipeline).toHaveBeenCalledWith(DOCUMENT_ID, undefined)
      expect(refreshResults).toHaveBeenCalledTimes(1)
    })
  })
})
