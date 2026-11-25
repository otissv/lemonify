import { describe, expect, it } from 'vitest'

import type { DocumentView } from '@/features/documents/document'
import {
  canRedoNow,
  canUndoNow,
  replayPending,
  shownPipeline,
  shownWorkflow,
  withConfirmed,
} from '@/features/pipeline/pipeline-session'
import type {
  DocumentSession,
  WorkflowSession,
} from '@/features/pipeline/pipeline-session'
import { createSharpStep } from '@/features/pipeline/pipeline'
import { pipelineOf } from '@/test/pipelines'
import { workflowDefinition } from '@/test/workflow-fixtures'
import type { WorkflowView } from '@/server/services/workflow-service'

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
    sources: [],
    pipeline: pipelineOf(...steps),
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
  return { kind: 'document', confirmed: view(steps), pending, syncing: false }
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

describe('replayPending', () => {
  const blur = createSharpStep('blur')
  const flip = createSharpStep('flip')
  const base = (
    steps: ReturnType<typeof createSharpStep>[],
    canUndo = false,
    canRedo = false,
  ) => ({
    kind: 'document' as const,
    pipeline: pipelineOf(...steps),
    canUndo,
    canRedo,
  })
  const add = (id: number, step: typeof blur, index: number) => ({
    id,
    op: { kind: 'change', change: { type: 'add-step', step, index } } as const,
  })

  it('keeps edits that still apply, in order', () => {
    const pending = [add(1, blur, 0), add(2, flip, 1)]

    expect(replayPending(base([]), pending)).toEqual({ pending, dropped: 0 })
  })

  it('keeps edits that apply on top of what the other tab did', () => {
    const remove = {
      id: 1,
      op: { kind: 'change', change: { type: 'remove-step', stepId: blur.id } },
    } as const

    expect(replayPending(base([blur, flip]), [remove])).toEqual({
      pending: [remove],
      dropped: 0,
    })
  })

  it('drops an edit whose step is gone, and says how many', () => {
    const remove = {
      id: 1,
      op: { kind: 'change', change: { type: 'remove-step', stepId: blur.id } },
    } as const
    const keep = add(2, flip, 0)

    expect(replayPending(base([]), [remove, keep])).toEqual({
      pending: [keep],
      dropped: 1,
    })
  })

  it('checks each edit against the ones kept before it', () => {
    const second = {
      id: 2,
      op: { kind: 'change', change: { type: 'remove-step', stepId: blur.id } },
    } as const
    const first = add(1, blur, 0)

    expect(replayPending(base([]), [first, second]).dropped).toBe(0)
    expect(replayPending(base([]), [second, first])).toEqual({
      pending: [first],
      dropped: 1,
    })
  })

  it('keeps an undo or redo only while there is something to undo or redo', () => {
    const undo = { id: 1, op: { kind: 'undo' } } as const
    const redo = { id: 2, op: { kind: 'redo' } } as const

    expect(replayPending(base([], false, false), [undo, redo])).toEqual({
      pending: [],
      dropped: 2,
    })
    expect(replayPending(base([], true, false), [undo])).toEqual({
      pending: [undo],
      dropped: 0,
    })
    expect(replayPending(base([], false, true), [redo])).toEqual({
      pending: [redo],
      dropped: 0,
    })
  })

  it('knows an edit makes undo possible and redo not', () => {
    const undo = { id: 2, op: { kind: 'undo' } } as const
    const redo = { id: 3, op: { kind: 'redo' } } as const

    expect(
      replayPending(base([], false, true), [add(1, blur, 0), undo]).pending,
    ).toEqual([add(1, blur, 0), undo])
    expect(
      replayPending(base([], false, true), [add(1, blur, 0), redo]),
    ).toEqual({ pending: [add(1, blur, 0)], dropped: 1 })
  })

  it('keeps everything after an undo or redo, which only the server can judge', () => {
    const undo = { id: 1, op: { kind: 'undo' } } as const
    const unknown = {
      id: 2,
      op: { kind: 'change', change: { type: 'remove-step', stepId: 'nope' } },
    } as const

    expect(replayPending(base([], true), [undo, unknown])).toEqual({
      pending: [undo, unknown],
      dropped: 0,
    })
  })

  it('does nothing for nothing waiting', () => {
    expect(replayPending(base([]), [])).toEqual({ pending: [], dropped: 0 })
  })
})

function workflowView(inputs: string[] = []): WorkflowView {
  return {
    id: 'w1',
    name: 'Flow',
    ...workflowDefinition(),
    inputs,
    revision: 2,
    canUndo: false,
    canRedo: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function workflowSession(
  pending: WorkflowSession['pending'],
  inputs: string[] = [],
): WorkflowSession {
  return {
    kind: 'workflow',
    confirmed: workflowView(inputs),
    pending,
    syncing: false,
  }
}

describe('a workflow session', () => {
  const setInputs = (id: number, sourceIds: string[]) => ({
    id,
    op: { kind: 'change', change: { type: 'set-inputs', sourceIds } } as const,
  })

  it('shows the inputs, the output and the pipeline with the waiting changes applied', () => {
    const flip = createSharpStep('flip')
    const shown = shownWorkflow(
      workflowSession([
        setInputs(1, ['a', 'b']),
        {
          id: 2,
          op: {
            kind: 'change',
            change: { type: 'add-step', step: flip, index: 1 },
          },
        },
      ]),
    )
    expect(shown.inputs).toEqual(['a', 'b'])
    expect(shown.pipeline.steps.map(({ id }) => id)).toContain(flip.id)
    expect(shownPipeline(workflowSession([])).steps).toHaveLength(1)
  })

  it('can undo what is waiting and follows the server otherwise', () => {
    expect(canUndoNow(workflowSession([]))).toBe(false)
    expect(canUndoNow(workflowSession([setInputs(1, ['a'])]))).toBe(true)
    expect(canRedoNow(workflowSession([setInputs(1, ['a'])]))).toBe(false)
  })

  it('replays waiting changes on a newer workflow, dropping those that no longer apply', () => {
    const view = workflowView(['a'])
    const stale = {
      id: 1,
      op: { kind: 'change', change: { type: 'remove-step', stepId: 'gone' } },
    } as const
    const keep = setInputs(2, ['a', 'b'])
    expect(
      replayPending(
        {
          kind: 'workflow',
          definition: {
            pipeline: view.pipeline,
            canvasSize: view.canvasSize,
            inputs: view.inputs,
            output: view.output,
          },
          canUndo: false,
          canRedo: false,
        },
        [stale, keep],
      ),
    ).toEqual({ pending: [keep], dropped: 1 })
  })
})

describe('a document session', () => {
  it('refuses a change only a workflow has, as one that does not apply', () => {
    const waiting = session(
      [],
      [
        {
          id: 1,
          op: { kind: 'change', change: { type: 'set-inputs', sourceIds: [] } },
        },
      ],
    )
    expect(() => shownPipeline(waiting)).toThrow()
  })
})

describe('withConfirmed', () => {
  it('replaces the confirmed state of the same kind and ignores the other kind', () => {
    const doc = session([], [])
    const next = { ...view([]), revision: 9 }
    expect(withConfirmed(doc, { kind: 'document', view: next }).confirmed).toBe(
      next,
    )
    expect(withConfirmed(doc, { kind: 'workflow', view: workflowView() })).toBe(
      doc,
    )
  })
})
