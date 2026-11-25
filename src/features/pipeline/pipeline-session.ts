import type { DocumentView } from '@/features/documents/document'
import {
  InvalidChangeError,
  applyChange,
  isDocumentChange,
} from '@/features/pipeline/document-change'
import type { Pipeline } from '@/features/pipeline/pipeline'
import type { WorkflowDefinition } from '@/features/workflows/workflow'
import { applyWorkflowChange } from '@/features/workflows/workflow-change'
import type { WorkflowChange } from '@/features/workflows/workflow-change'
import type { WorkflowView } from '@/server/services/workflow-service'

/**
 * What the editor asks the server to do next, in the order the person did it.
 * A document takes the changes `isDocumentChange` accepts; a workflow takes
 * those and the few only it has.
 */
export type PipelineOperation =
  | { kind: 'change'; change: WorkflowChange }
  | { kind: 'undo' }
  | { kind: 'redo' }

export type PendingOperation = { id: number; op: PipelineOperation }

type SessionState = {
  pending: ReadonlyArray<PendingOperation>
  /** Why the last operation failed; the session was reloaded from the server. */
  error?: string
  syncing: boolean
}

/**
 * A Document or a Workflow as the editor holds it: the last state the server
 * confirmed, and the operations sent or waiting to be sent one at a time. What
 * is on screen is the confirmed state with the waiting changes applied, so an
 * edit shows at once. Both are pipelines with an Edit history, so they are
 * edited, undone and kept in step with the server by the same code.
 */
export type DocumentSession = SessionState & {
  kind: 'document'
  confirmed: DocumentView
}

export type WorkflowSession = SessionState & {
  kind: 'workflow'
  confirmed: WorkflowView
}

export type PipelineSession = DocumentSession | WorkflowSession

/** A state the server confirmed, with which kind of pipeline it is. */
export type SessionView =
  | { kind: 'document'; view: DocumentView }
  | { kind: 'workflow'; view: WorkflowView }

export function documentSessionOf(
  session: PipelineSession | undefined,
): DocumentSession | undefined {
  return session?.kind === 'document' ? session : undefined
}

export function workflowSessionOf(
  session: PipelineSession | undefined,
): WorkflowSession | undefined {
  return session?.kind === 'workflow' ? session : undefined
}

/** The session with the confirmed state replaced; a state of the other kind changes nothing. */
export function withConfirmed(
  session: PipelineSession,
  update: SessionView,
  changes: Partial<SessionState> = {},
): PipelineSession {
  if (session.kind === 'document' && update.kind === 'document') {
    return { ...session, ...changes, confirmed: update.view }
  }
  if (session.kind === 'workflow' && update.kind === 'workflow') {
    return { ...session, ...changes, confirmed: update.view }
  }
  return session
}

export function newSession(
  update: SessionView,
  state: SessionState,
): PipelineSession {
  return update.kind === 'document'
    ? { kind: 'document', confirmed: update.view, ...state }
    : { kind: 'workflow', confirmed: update.view, ...state }
}

function applyToPipeline(pipeline: Pipeline, change: WorkflowChange): Pipeline {
  if (!isDocumentChange(change)) {
    throw new InvalidChangeError('A document cannot take that change.')
  }
  return applyChange(pipeline, change)
}

function definitionOf(view: WorkflowView): WorkflowDefinition {
  return {
    pipeline: view.pipeline,
    canvasSize: view.canvasSize,
    inputs: view.inputs,
    output: view.output,
  }
}

/**
 * The workflow on screen: the confirmed one with the waiting changes applied in
 * order. An undo or redo changes it in ways only the server knows, so showing
 * stops there until the server answers.
 */
export function shownWorkflow(session: WorkflowSession): WorkflowDefinition {
  let definition = definitionOf(session.confirmed)
  for (const { op } of session.pending) {
    if (op.kind !== 'change') break
    definition = applyWorkflowChange(definition, op.change)
  }
  return definition
}

/** The Pipeline on screen, of a document or a workflow; see `shownWorkflow`. */
export function shownPipeline(session: PipelineSession): Pipeline {
  if (session.kind === 'workflow') return shownWorkflow(session).pipeline
  let pipeline = session.confirmed.pipeline
  for (const { op } of session.pending) {
    if (op.kind !== 'change') break
    pipeline = applyToPipeline(pipeline, op.change)
  }
  return pipeline
}

function hasChange(session: PipelineSession): boolean {
  return session.pending.some(({ op }) => op.kind === 'change')
}

export function canUndoNow(session: PipelineSession): boolean {
  return session.confirmed.canUndo || hasChange(session)
}

export function canRedoNow(session: PipelineSession): boolean {
  return session.confirmed.canRedo && !hasChange(session)
}

/** What the person is told when edits they made could not be kept on top of a change from another tab. */
export const DROPPED_EDITS_MESSAGE =
  'Some of your changes could not be kept, because this was changed in another tab.'

/** The state of a pipeline as the server holds it now, newer than the one the waiting operations were made on. */
export type ReplayBase =
  | { kind: 'document'; pipeline: Pipeline; canUndo: boolean; canRedo: boolean }
  | {
      kind: 'workflow'
      definition: WorkflowDefinition
      canUndo: boolean
      canRedo: boolean
    }

export function replayBaseOf(update: SessionView): ReplayBase {
  const { canUndo, canRedo } = update.view
  return update.kind === 'document'
    ? { kind: 'document', pipeline: update.view.pipeline, canUndo, canRedo }
    : {
        kind: 'workflow',
        definition: definitionOf(update.view),
        canUndo,
        canRedo,
      }
}

function applyOnBase(base: ReplayBase, change: WorkflowChange): ReplayBase {
  return base.kind === 'document'
    ? { ...base, pipeline: applyToPipeline(base.pipeline, change) }
    : { ...base, definition: applyWorkflowChange(base.definition, change) }
}

/**
 * The waiting operations, made again on top of a newer state from the server.
 * An edit that still applies is kept; one that no longer does (its step is
 * gone, say) is dropped and counted. An undo or redo is kept while there is
 * something to undo or redo. Once one is kept, what follows cannot be checked
 * here (only the server knows what it does), so the rest are kept as they are
 * and the server has the last word.
 */
export function replayPending(
  start: ReplayBase,
  pending: ReadonlyArray<PendingOperation>,
): { pending: PendingOperation[]; dropped: number } {
  const kept: PendingOperation[] = []
  let dropped = 0
  let base = start
  let checking = true
  for (const operation of pending) {
    const { op } = operation
    if (!checking) {
      kept.push(operation)
      continue
    }
    if (op.kind === 'undo' || op.kind === 'redo') {
      if (op.kind === 'undo' ? !base.canUndo : !base.canRedo) {
        dropped += 1
        continue
      }
      kept.push(operation)
      checking = false
      continue
    }
    try {
      base = { ...applyOnBase(base, op.change), canUndo: true, canRedo: false }
    } catch (error) {
      if (!(error instanceof InvalidChangeError)) throw error
      dropped += 1
      continue
    }
    kept.push(operation)
  }
  return { pending: kept, dropped }
}
