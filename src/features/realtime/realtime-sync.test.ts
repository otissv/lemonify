import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { reconcileDocument } from '@/features/documents/document-sync'
import {
  DELETED_NOTICE,
  createListRefresher,
  createRealtimeSync,
} from '@/features/realtime/realtime-sync'
import { INITIAL_APP_STATE, useAppStore } from '@/store/app-store'
import { DOCUMENT_ID, documentView } from '@/test/document-fixtures'

vi.mock('@/features/documents/document-sync', () => ({
  reconcileDocument: vi.fn(),
}))

beforeEach(() => {
  useAppStore.setState(INITIAL_APP_STATE)
  vi.mocked(reconcileDocument).mockResolvedValue(undefined)
})

afterEach(() => {
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
      openDocumentId: () => open,
      leaveDocument,
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

    expect(reconcileDocument).toHaveBeenCalledWith('d1', {
      revision: 4,
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('does not stop on a document that could not be read', async () => {
    vi.mocked(reconcileDocument).mockRejectedValue(new Error('offline'))
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

    expect(useAppStore.getState().resultsVersion).toBe(1)
  })

  it('does nothing for a heartbeat', () => {
    const { sync, invalidate } = make()

    sync.handle({ type: 'heartbeat' })

    expect(invalidate).not.toHaveBeenCalled()
    expect(useAppStore.getState().resultsVersion).toBe(0)
  })

  describe('a document deleted elsewhere', () => {
    it('is forgotten here, and the person is told if they had it open', () => {
      useAppStore.getState().confirmDocument(documentView(), true)
      const { sync, leaveDocument } = make(DOCUMENT_ID)

      sync.handle({ type: 'document.deleted', documentId: DOCUMENT_ID })

      expect(useAppStore.getState().documents[DOCUMENT_ID]).toBeUndefined()
      expect(leaveDocument).toHaveBeenCalled()
      expect(useAppStore.getState().liveNotice).toBe(DELETED_NOTICE)
    })

    it('is forgotten quietly when it was not the one open', () => {
      useAppStore.getState().confirmDocument(documentView(), true)
      const { sync, leaveDocument } = make('another')

      sync.handle({ type: 'document.deleted', documentId: DOCUMENT_ID })

      expect(useAppStore.getState().documents[DOCUMENT_ID]).toBeUndefined()
      expect(leaveDocument).not.toHaveBeenCalled()
      expect(useAppStore.getState().liveNotice).toBeUndefined()
    })
  })

  describe('catching up', () => {
    it('reads the lists and every open document, as nothing is known of what was missed', async () => {
      useAppStore.getState().confirmDocument(documentView(), true)
      const { sync, invalidate } = make()

      await sync.catchUp()

      expect(invalidate).toHaveBeenCalled()
      expect(reconcileDocument).toHaveBeenCalledWith(DOCUMENT_ID, undefined)
      expect(useAppStore.getState().resultsVersion).toBe(1)
    })
  })
})
