import {
  changeDocument,
  getDocument,
  redoDocument,
  undoDocument,
} from '@/features/documents/document-functions'
import { isDocumentChange } from '@/features/pipeline/document-change'
import type { DocumentChange } from '@/features/pipeline/document-change'
import {
  DROPPED_EDITS_MESSAGE,
  canRedoNow,
  canUndoNow,
  replayBaseOf,
  replayPending,
  shownPipeline,
  shownWorkflow,
} from '@/features/pipeline/pipeline-session'
import type {
  PipelineOperation,
  PipelineSession,
  SessionView,
} from '@/features/pipeline/pipeline-session'
import {
  InvalidChangeError,
  applyChange,
} from '@/features/pipeline/document-change'
import { applyWorkflowChange } from '@/features/workflows/workflow-change'
import type { WorkflowChange } from '@/features/workflows/workflow-change'
import {
  changeWorkflow,
  getWorkflow,
  redoWorkflow,
  undoWorkflow,
} from '@/features/workflows/workflow-functions'
import { errorMessage } from '@/lib/error-message'
import { usePipelineStore } from '@/store/pipeline-store'

const SAVE_FAILED = 'The change could not be saved.'

const running = new Map<string, Promise<void>>()

function send(
  session: PipelineSession,
  op: PipelineOperation,
): Promise<SessionView> {
  const id = session.confirmed.id
  const revision = session.confirmed.revision
  if (session.kind === 'document') {
    switch (op.kind) {
      case 'change': {
        const { change } = op
        if (!isDocumentChange(change)) {
          return Promise.reject(
            new InvalidChangeError('A document cannot take that change.'),
          )
        }
        return changeDocument({ data: { id, revision, change } }).then(
          (view) => ({ kind: 'document', view }),
        )
      }
      case 'undo':
        return undoDocument({ data: { id, revision } }).then((view) => ({
          kind: 'document',
          view,
        }))
      case 'redo':
        return redoDocument({ data: { id, revision } }).then((view) => ({
          kind: 'document',
          view,
        }))
    }
  }
  switch (op.kind) {
    case 'change':
      return changeWorkflow({
        data: { id, revision, change: op.change },
      }).then((view) => ({ kind: 'workflow', view }))
    case 'undo':
      return undoWorkflow({ data: { id, revision } }).then((view) => ({
        kind: 'workflow',
        view,
      }))
    case 'redo':
      return redoWorkflow({ data: { id, revision } }).then((view) => ({
        kind: 'workflow',
        view,
      }))
  }
}

function fetchLatest(session: PipelineSession): Promise<SessionView> {
  const id = session.confirmed.id
  return session.kind === 'document'
    ? getDocument({ data: { id } }).then((view) => ({ kind: 'document', view }))
    : getWorkflow({ data: { id } }).then((view) => ({ kind: 'workflow', view }))
}

/**
 * Takes a newer state from the server and makes the waiting operations again on
 * top of it, dropping any that no longer apply and saying so.
 */
function rebase(update: SessionView): void {
  const store = usePipelineStore.getState()
  const session = store.sessions[update.view.id]
  if (!session) return
  const { pending, dropped } = replayPending(
    replayBaseOf(update),
    session.pending,
  )
  store.rebaseSession(
    update,
    pending,
    dropped > 0 ? DROPPED_EDITS_MESSAGE : undefined,
  )
}

type Recovery = 'retry' | 'stop'

/**
 * Sorts out an operation the server refused. If the server's pipeline has
 * moved on since the operation was made, it was made on out-of-date state (a
 * change from another tab landed first), so the waiting operations are made
 * again on top of the new state and sending carries on. Otherwise the server
 * meant it: the waiting operations are dropped and the reason stays on screen.
 */
async function recover(
  session: PipelineSession,
  sentRevision: number,
  error: unknown,
): Promise<Recovery> {
  const id = session.confirmed.id
  let latest: SessionView
  try {
    latest = await fetchLatest(session)
  } catch {
    usePipelineStore
      .getState()
      .failSession(id, errorMessage(error, SAVE_FAILED))
    return 'stop'
  }
  if (latest.view.revision > sentRevision) {
    rebase(latest)
    return 'retry'
  }
  const store = usePipelineStore.getState()
  store.failSession(id, errorMessage(error, SAVE_FAILED))
  confirm(latest, true)
  return 'stop'
}

function confirm(update: SessionView, reset: boolean): void {
  const store = usePipelineStore.getState()
  if (update.kind === 'document') store.confirmDocument(update.view, reset)
  else store.confirmWorkflow(update.view, reset)
}

async function drain(id: string): Promise<void> {
  try {
    for (;;) {
      const session = usePipelineStore.getState().sessions[id]
      const head = session?.pending[0]
      if (!session || !head) return
      usePipelineStore.getState().setSyncing(id, true)
      const sentRevision = session.confirmed.revision
      try {
        const update = await send(session, head.op)
        usePipelineStore.getState().settleOperation(update)
      } catch (error) {
        if ((await recover(session, sentRevision, error)) === 'stop') return
      }
    }
  } finally {
    running.delete(id)
    usePipelineStore.getState().setSyncing(id, false)
  }
}

/** Sends the pipeline's waiting operations to the server, one at a time, in order. */
function pump(id: string): Promise<void> {
  const active = running.get(id)
  if (active) return active
  const started = drain(id)
  running.set(id, started)
  return started
}

/** Resolves once every edit made so far has been sent, so what the server holds is what the editor shows. */
export function settlePipeline(id: string): Promise<void> {
  return running.get(id) ?? Promise.resolve()
}

/** Reads a document from the server into the editor, unless it is already there. */
export async function loadDocument(id: string): Promise<void> {
  if (usePipelineStore.getState().sessions[id]) return
  const view = await getDocument({ data: { id } })
  usePipelineStore.getState().confirmDocument(view, false)
}

/** Reads a workflow from the server into the editor, unless it is already there. */
export async function loadWorkflow(id: string): Promise<void> {
  if (usePipelineStore.getState().sessions[id]) return
  const view = await getWorkflow({ data: { id } })
  usePipelineStore.getState().confirmWorkflow(view, false)
}

function queueChange(
  id: string,
  change: WorkflowChange,
  check: (session: PipelineSession) => void,
): Promise<void> {
  const store = usePipelineStore.getState()
  const session = store.sessions[id]
  if (!session) return Promise.resolve()
  try {
    check(session)
  } catch (error) {
    if (!(error instanceof InvalidChangeError)) throw error
    store.setSessionError(id, error.message)
    return Promise.resolve()
  }
  store.queueOperation(id, { kind: 'change', change })
  return pump(id)
}

/**
 * Makes one change to the pipeline of a document or a workflow, which take the
 * same changes. It shows at once and is sent after the changes before it; the
 * returned promise settles when the queue is empty.
 */
export function applyEdit(id: string, change: DocumentChange): Promise<void> {
  return queueChange(id, change, (session) => {
    if (session.kind === 'document') {
      applyChange(shownPipeline(session), change)
      return
    }
    applyWorkflowChange(shownWorkflow(session), change)
  })
}

/** Makes one change to a workflow, including those only it has (its inputs and Output settings); it shows at once and is sent in order. */
export function applyWorkflowEdit(
  id: string,
  change: WorkflowChange,
): Promise<void> {
  return queueChange(id, change, (session) => {
    if (session.kind !== 'workflow') {
      throw new InvalidChangeError('That is not a workflow.')
    }
    applyWorkflowChange(shownWorkflow(session), change)
  })
}

export function undoEdit(id: string): Promise<void> {
  const store = usePipelineStore.getState()
  const session = store.sessions[id]
  if (!session || !canUndoNow(session)) return Promise.resolve()
  store.queueOperation(id, { kind: 'undo' })
  return pump(id)
}

export function redoEdit(id: string): Promise<void> {
  const store = usePipelineStore.getState()
  const session = store.sessions[id]
  if (!session || !canRedoNow(session)) return Promise.resolve()
  store.queueOperation(id, { kind: 'redo' })
  return pump(id)
}

/** What another tab says a pipeline is now. */
export type RemoteVersion = { revision: number; updatedAt: string }

/** Whether `remote` is a state the editor has not seen: a later revision, or the same one renamed since. */
export function isNewer(remote: RemoteVersion, held: RemoteVersion): boolean {
  if (remote.revision !== held.revision) return remote.revision > held.revision
  return remote.updatedAt > held.updatedAt
}

/**
 * Brings an open document or workflow up to date after another tab changed it.
 * Edits made here that are still on their way finish first (the server settles
 * which came first); then, if the server's version is still newer than the
 * editor's, it is read and shown. With no `remote` the server is asked whatever
 * it holds, as when a connection returns and nothing is known of what was
 * missed. One that is not open here is left alone: it is read fresh when it is
 * opened.
 */
export async function reconcilePipeline(
  id: string,
  remote?: RemoteVersion,
): Promise<void> {
  for (;;) {
    await settlePipeline(id)
    const held = usePipelineStore.getState().sessions[id]
    if (!held || (remote && !isNewer(remote, held.confirmed))) return
    const latest = await fetchLatest(held)
    const now = usePipelineStore.getState().sessions[id]
    if (!now) return
    if (running.has(id)) continue
    if (isNewer(latest.view, now.confirmed)) rebase(latest)
    return
  }
}
