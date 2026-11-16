import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  changeDocument,
  getDocument,
  undoDocument,
} from '@/features/documents/document-functions'
import type { DocumentView } from '@/features/documents/document'
import {
  applyEdit,
  loadDocument,
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
    pipeline: { steps },
    revision,
    canUndo,
    canRedo: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
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
})
