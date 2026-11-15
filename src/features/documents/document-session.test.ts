import { describe, expect, it } from 'vitest'

import type { DocumentView } from '@/features/documents/document'
import {
  canRedoNow,
  canUndoNow,
  shownPipeline,
} from '@/features/documents/document-session'
import type { DocumentSession } from '@/features/documents/document-session'
import { createSharpStep } from '@/features/pipeline/pipeline'

function view(steps: ReturnType<typeof createSharpStep>[]): DocumentView {
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
    pipeline: { steps },
    revision: 3,
    canUndo: false,
    canRedo: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function session(
  steps: ReturnType<typeof createSharpStep>[],
  pending: DocumentSession['pending'],
): DocumentSession {
  return { confirmed: view(steps), pending, syncing: false }
}

describe('shownPipeline', () => {
  it('is the confirmed pipeline when nothing is waiting', () => {
    const blur = createSharpStep('blur')
    expect(shownPipeline(session([blur], [])).steps).toEqual([blur])
  })

  it('applies waiting changes in order, before the server has answered', () => {
    const blur = createSharpStep('blur')
    const flip = createSharpStep('flip')
    const shown = shownPipeline(
      session(
        [blur],
        [
          {
            id: 1,
            op: {
              kind: 'change',
              change: { type: 'add-step', step: flip, index: 1 },
            },
          },
          {
            id: 2,
            op: {
              kind: 'change',
              change: { type: 'remove-step', stepId: blur.id },
            },
          },
        ],
      ),
    )
    expect(shown.steps.map(({ id }) => id)).toEqual([flip.id])
  })

  it('stops at an undo, whose result only the server knows', () => {
    const blur = createSharpStep('blur')
    const flip = createSharpStep('flip')
    const shown = shownPipeline(
      session(
        [blur],
        [
          { id: 1, op: { kind: 'undo' } },
          {
            id: 2,
            op: {
              kind: 'change',
              change: { type: 'add-step', step: flip, index: 1 },
            },
          },
        ],
      ),
    )
    expect(shown.steps).toEqual([blur])
  })
})

describe('canUndoNow and canRedoNow', () => {
  it('follow the server when nothing is waiting', () => {
    const idle = session([], [])
    expect(canUndoNow(idle)).toBe(false)
    expect(canRedoNow(idle)).toBe(true)
  })

  it('can undo a change that is waiting, and cannot redo after it', () => {
    const waiting = session(
      [],
      [
        {
          id: 1,
          op: {
            kind: 'change',
            change: {
              type: 'add-step',
              step: createSharpStep('flip'),
              index: 0,
            },
          },
        },
      ],
    )
    expect(canUndoNow(waiting)).toBe(true)
    expect(canRedoNow(waiting)).toBe(false)
  })
})
