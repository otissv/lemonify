import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  changeDocument,
  getDocument,
  undoDocument,
} from '@/features/documents/document-functions'
import type { DocumentView } from '@/features/documents/document'
import {
  applyEdit,
  isNewer,
  loadDocument,
  reconcileDocument,
  settleDocument,
  undoEdit,
} from '@/features/documents/document-sync'
import { createSharpStep } from '@/features/pipeline/pipeline'
import {
  INITIAL_APP_STATE,
  currentPipeline,
  useAppStore,
} from '@/store/app-store'

vi.mock('@/features/documents/document-functions', () => ({
  getDocument: vi.fn(),
  changeDocument: vi.fn(),
  undoDocument: vi.fn(),
  redoDocument: vi.fn(),
}))

import { pipelineOf } from '@/test/pipelines'

function view(
  revision: number,
  steps: DocumentView['pipeline']['steps'],
  canUndo = false,
): DocumentView {
  return {
    id: 'd1',
    name: 'One',
    source: {
      id: 's1',
      fileName: 'one.png',
      mediaType: 'image/png',
      bytes: 1,
      width: 10,
      height: 10,
    },
    sources: [],
    pipeline: pipelineOf(...steps),
    revision,
    canUndo,
    canRedo: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function viewAt(
  revision: number,
  steps: DocumentView['pipeline']['steps'],
  updatedAt: string,
): DocumentView {
  return { ...view(revision, steps), updatedAt }
}

function session() {
  const found = useAppStore.getState().documents.d1
  if (!found) throw new Error('document not loaded')
  return found
}

describe('document sync', () => {
  beforeEach(async () => {
    useAppStore.setState(INITIAL_APP_STATE)
    vi.resetAllMocks()
    vi.mocked(getDocument).mockResolvedValue(view(0, []))
    await loadDocument('d1')
  })

  it('shows an edit at once and sends it on the revision the server last confirmed', async () => {
    const blur = createSharpStep('blur')
    vi.mocked(changeDocument).mockResolvedValue(view(1, [blur], true))
    const done = applyEdit('d1', { type: 'add-step', step: blur, index: 0 })
    expect(currentPipeline(useAppStore.getState(), 'd1')?.steps).toEqual([blur])
    await done
    expect(changeDocument).toHaveBeenCalledWith({
      data: {
        id: 'd1',
        revision: 0,
        change: { type: 'add-step', step: blur, index: 0 },
      },
    })
    expect(session().confirmed.revision).toBe(1)
    expect(session().pending).toEqual([])
  })

  it('says when every edit made so far has reached the server', async () => {
    const blur = createSharpStep('blur')
    let reply: (value: DocumentView) => void = () => {}
    vi.mocked(changeDocument).mockReturnValue(
      new Promise<DocumentView>((resolve) => {
        reply = resolve
      }),
    )
    void applyEdit('d1', { type: 'add-step', step: blur, index: 0 })

    let settled = false
    const waiting = settleDocument('d1').then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    reply(view(1, [blur], true))
    await waiting

    expect(session().pending).toEqual([])
  })

  it('has nothing to wait for when no edit is on its way', async () => {
    await expect(settleDocument('d1')).resolves.toBeUndefined()
  })

  it('sends queued edits one at a time, each on the revision before it', async () => {
    const blur = createSharpStep('blur')
    const flip = createSharpStep('flip')
    vi.mocked(changeDocument)
      .mockResolvedValueOnce(view(1, [blur], true))
      .mockResolvedValueOnce(view(2, [blur, flip], true))
    const first = applyEdit('d1', { type: 'add-step', step: blur, index: 0 })
    const second = applyEdit('d1', { type: 'add-step', step: flip, index: 1 })
    await Promise.all([first, second])
    const revisions = vi
      .mocked(changeDocument)
      .mock.calls.map(([{ data }]) => data.revision)
    expect(revisions).toEqual([0, 1])
    expect(session().confirmed.pipeline.steps).toEqual([blur, flip])
  })

  it('drops the waiting edits and reloads when the server refuses one', async () => {
    const blur = createSharpStep('blur')
    vi.mocked(changeDocument).mockRejectedValue(new Error('Changed elsewhere.'))
    vi.mocked(getDocument).mockResolvedValue(view(4, []))
    await applyEdit('d1', { type: 'add-step', step: blur, index: 0 })
    expect(session().error).toBe('Changed elsewhere.')
    expect(session().pending).toEqual([])
    expect(session().confirmed.revision).toBe(4)
  })

  it('refuses an edit that is not valid without asking the server', async () => {
    await applyEdit('d1', { type: 'remove-step', stepId: 'missing' })
    expect(changeDocument).not.toHaveBeenCalled()
    expect(session().error).toBe('That step is no longer in the pipeline.')
  })

  it('undoes through the server, and only when there is something to undo', async () => {
    await undoEdit('d1')
    expect(undoDocument).not.toHaveBeenCalled()
    useAppStore.getState().confirmDocument(view(1, [], true), true)
    vi.mocked(undoDocument).mockResolvedValue(view(2, []))
    await undoEdit('d1')
    expect(undoDocument).toHaveBeenCalledWith({
      data: { id: 'd1', revision: 1 },
    })
    expect(session().confirmed.revision).toBe(2)
  })

  describe('when another tab changed the document first', () => {
    it('makes the waiting edits again on the new state, and sends them on its revision', async () => {
      const flip = createSharpStep('flip')
      const blur = createSharpStep('blur')
      vi.mocked(changeDocument)
        .mockRejectedValueOnce(
          new Error('This image was changed somewhere else.'),
        )
        .mockResolvedValueOnce(view(2, [flip, blur], true))
      vi.mocked(getDocument).mockResolvedValue(view(1, [flip], true))

      await applyEdit('d1', { type: 'add-step', step: blur, index: 0 })

      expect(changeDocument).toHaveBeenNthCalledWith(2, {
        data: {
          id: 'd1',
          revision: 1,
          change: { type: 'add-step', step: blur, index: 0 },
        },
      })
      expect(session().confirmed.revision).toBe(2)
      expect(session().pending).toEqual([])
      expect(session().error).toBeUndefined()
    })

    it('drops an edit that no longer applies, says so, and sends the rest', async () => {
      const flip = createSharpStep('flip')
      const blur = createSharpStep('blur')
      useAppStore.getState().confirmDocument(view(1, [flip], true), true)
      vi.mocked(changeDocument)
        .mockRejectedValueOnce(
          new Error('This image was changed somewhere else.'),
        )
        .mockResolvedValueOnce(view(3, [flip, blur], true))
      vi.mocked(getDocument).mockResolvedValue(view(2, [], true))

      const first = applyEdit('d1', { type: 'remove-step', stepId: flip.id })
      const second = applyEdit('d1', { type: 'add-step', step: blur, index: 0 })
      await Promise.all([first, second])

      expect(changeDocument).toHaveBeenCalledTimes(2)
      expect(changeDocument).toHaveBeenLastCalledWith({
        data: {
          id: 'd1',
          revision: 2,
          change: { type: 'add-step', step: blur, index: 0 },
        },
      })
      expect(session().confirmed.revision).toBe(3)
    })

    it('tells the person when edits could not be kept', async () => {
      const flip = createSharpStep('flip')
      useAppStore.getState().confirmDocument(view(1, [flip], true), true)
      vi.mocked(changeDocument).mockRejectedValueOnce(
        new Error('This image was changed somewhere else.'),
      )
      vi.mocked(getDocument).mockResolvedValue(view(2, [], true))

      await applyEdit('d1', { type: 'remove-step', stepId: flip.id })

      expect(session().error).toBe(
        'Some of your changes could not be kept, because this image was changed in another tab.',
      )
      expect(session().pending).toEqual([])
      expect(session().confirmed.revision).toBe(2)
    })

    it('gives up when the server refuses again on the newest state, keeping its reason', async () => {
      const blur = createSharpStep('blur')
      vi.mocked(changeDocument).mockRejectedValue(new Error('Not allowed.'))
      vi.mocked(getDocument).mockResolvedValue(view(1, [], true))

      await applyEdit('d1', { type: 'add-step', step: blur, index: 0 })

      expect(changeDocument).toHaveBeenCalledTimes(2)
      expect(session().error).toBe('Not allowed.')
      expect(session().pending).toEqual([])
      expect(session().confirmed.revision).toBe(1)
    })

    it('keeps the reason and drops the edits when the document cannot be read again', async () => {
      const blur = createSharpStep('blur')
      vi.mocked(changeDocument).mockRejectedValue(
        new Error('Changed elsewhere.'),
      )
      vi.mocked(getDocument).mockRejectedValue(new Error('Offline.'))

      await applyEdit('d1', { type: 'add-step', step: blur, index: 0 })

      expect(session().error).toBe('Changed elsewhere.')
      expect(session().pending).toEqual([])
    })
  })

  describe('reconcileDocument', () => {
    const REMOTE = { revision: 1, updatedAt: '2026-01-01T00:00:00.000Z' }

    it('reads and shows a document another tab changed', async () => {
      const blur = createSharpStep('blur')
      vi.mocked(getDocument).mockResolvedValue(view(1, [blur], true))

      await reconcileDocument('d1', REMOTE)

      expect(currentPipeline(useAppStore.getState(), 'd1')?.steps).toEqual([
        blur,
      ])
      expect(session().confirmed.revision).toBe(1)
    })

    it('reads a document that was only renamed', async () => {
      useAppStore.getState().confirmDocument(view(1, [], true), true)
      vi.mocked(getDocument).mockResolvedValue({
        ...viewAt(1, [], '2026-02-01T00:00:00.000Z'),
        name: 'Renamed',
      })

      await reconcileDocument('d1', {
        revision: 1,
        updatedAt: '2026-02-01T00:00:00.000Z',
      })

      expect(session().confirmed.name).toBe('Renamed')
    })

    it('does not read a document the editor already has', async () => {
      useAppStore.getState().confirmDocument(view(1, [], true), true)
      vi.mocked(getDocument).mockClear()

      await reconcileDocument('d1', REMOTE)
      await reconcileDocument('d1', { ...REMOTE, revision: 0 })

      expect(getDocument).not.toHaveBeenCalled()
    })

    it('leaves a document that is not open here alone', async () => {
      vi.mocked(getDocument).mockClear()

      await reconcileDocument('elsewhere', REMOTE)

      expect(getDocument).not.toHaveBeenCalled()
    })

    it('does not take a state older than the one it has', async () => {
      useAppStore.getState().confirmDocument(view(5, [], true), true)
      vi.mocked(getDocument).mockResolvedValue(view(3, [], true))

      await reconcileDocument('d1', { ...REMOTE, revision: 9 })

      expect(session().confirmed.revision).toBe(5)
    })

    it('waits for edits on their way to finish first', async () => {
      const blur = createSharpStep('blur')
      let finish: (document: DocumentView) => void = () => undefined
      vi.mocked(changeDocument).mockReturnValue(
        new Promise<DocumentView>((resolve) => {
          finish = resolve
        }),
      )
      vi.mocked(getDocument).mockClear()
      void applyEdit('d1', { type: 'add-step', step: blur, index: 0 })

      const reconciled = reconcileDocument('d1', {
        revision: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
      await Promise.resolve()
      expect(getDocument).not.toHaveBeenCalled()

      finish(view(1, [blur], true))
      await reconciled

      expect(getDocument).not.toHaveBeenCalled()
      expect(session().confirmed.revision).toBe(1)
    })

    it('reads the document after its own edit when the other tab was ahead', async () => {
      const blur = createSharpStep('blur')
      const flip = createSharpStep('flip')
      vi.mocked(changeDocument).mockResolvedValue(view(1, [blur], true))
      vi.mocked(getDocument).mockResolvedValue(view(2, [blur, flip], true))

      await applyEdit('d1', { type: 'add-step', step: blur, index: 0 })
      await reconcileDocument('d1', {
        revision: 2,
        updatedAt: '2026-01-01T00:00:00.000Z',
      })

      expect(session().confirmed.revision).toBe(2)
    })
  })

  describe('isNewer', () => {
    const held = { revision: 2, updatedAt: '2026-01-02T00:00:00.000Z' }

    it('is newer by revision, or by update time at the same revision', () => {
      expect(isNewer({ ...held, revision: 3 }, held)).toBe(true)
      expect(
        isNewer({ ...held, updatedAt: '2026-01-03T00:00:00.000Z' }, held),
      ).toBe(true)
    })

    it('is not newer when it is the same or older', () => {
      expect(isNewer(held, held)).toBe(false)
      expect(isNewer({ ...held, revision: 1 }, held)).toBe(false)
      expect(
        isNewer({ ...held, updatedAt: '2026-01-01T00:00:00.000Z' }, held),
      ).toBe(false)
      expect(
        isNewer({ revision: 1, updatedAt: '2030-01-01T00:00:00.000Z' }, held),
      ).toBe(false)
    })
  })
})
