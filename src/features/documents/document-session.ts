import type { DocumentView } from '@/features/documents/document'
import { applyChange } from '@/features/pipeline/document-change'
import type { DocumentChange } from '@/features/pipeline/document-change'
import type { Pipeline } from '@/features/pipeline/pipeline'

/** What the editor asks the server to do next, in the order the person did it. */
export type DocumentOperation =
  | { kind: 'change'; change: DocumentChange }
  | { kind: 'undo' }
  | { kind: 'redo' }

export type PendingOperation = { id: number; op: DocumentOperation }

/**
 * A Document as the editor holds it: the last state the server confirmed, and
 * the operations sent or waiting to be sent one at a time. What is on screen is
 * the confirmed state with the waiting changes applied, so an edit shows at once.
 */
export type DocumentSession = {
  confirmed: DocumentView
  pending: ReadonlyArray<PendingOperation>
  /** Why the last operation failed; the session was reloaded from the server. */
  error?: string
  syncing: boolean
}

/**
 * The Pipeline on screen. Changes are applied to the confirmed Pipeline in
 * order; an undo or redo changes it in ways only the server knows, so showing
 * stops there until the server answers.
 */
export function shownPipeline(session: DocumentSession): Pipeline {
  let pipeline = session.confirmed.pipeline
  for (const { op } of session.pending) {
    if (op.kind !== 'change') break
    pipeline = applyChange(pipeline, op.change)
  }
  return pipeline
}

function hasChange(session: DocumentSession): boolean {
  return session.pending.some(({ op }) => op.kind === 'change')
}

export function canUndoNow(session: DocumentSession): boolean {
  return session.confirmed.canUndo || hasChange(session)
}

export function canRedoNow(session: DocumentSession): boolean {
  return session.confirmed.canRedo && !hasChange(session)
}
