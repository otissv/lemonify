import type { DocumentView } from '@/features/documents/document'
import {
  InvalidChangeError,
  applyChange,
} from '@/features/pipeline/document-change'
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

/** What the person is told when edits they made could not be kept on top of a change from another tab. */
export const DROPPED_EDITS_MESSAGE =
  'Some of your changes could not be kept, because this image was changed in another tab.'

/** The state of a document as the server holds it now, newer than the one the waiting operations were made on. */
export type ReplayBase = Pick<DocumentView, 'pipeline' | 'canUndo' | 'canRedo'>

/**
 * The waiting operations, made again on top of a newer state from the server.
 * An edit that still applies is kept; one that no longer does (its step is
 * gone, say) is dropped and counted. An undo or redo is kept while there is
 * something to undo or redo. Once one is kept, what follows cannot be checked
 * here (only the server knows what it does), so the rest are kept as they are
 * and the server has the last word.
 */
export function replayPending(
  base: ReplayBase,
  pending: ReadonlyArray<PendingOperation>,
): { pending: PendingOperation[]; dropped: number } {
  const kept: PendingOperation[] = []
  let dropped = 0
  let { pipeline, canUndo, canRedo } = base
  let checking = true
  for (const operation of pending) {
    const { op } = operation
    if (!checking) {
      kept.push(operation)
      continue
    }
    if (op.kind === 'undo' || op.kind === 'redo') {
      if (op.kind === 'undo' ? !canUndo : !canRedo) {
        dropped += 1
        continue
      }
      kept.push(operation)
      checking = false
      continue
    }
    try {
      pipeline = applyChange(pipeline, op.change)
    } catch (error) {
      if (!(error instanceof InvalidChangeError)) throw error
      dropped += 1
      continue
    }
    kept.push(operation)
    canUndo = true
    canRedo = false
  }
  return { pending: kept, dropped }
}
