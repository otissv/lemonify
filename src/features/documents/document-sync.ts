import {
  changeDocument,
  getDocument,
  redoDocument,
  undoDocument,
} from '@/features/documents/document-functions'
import type { DocumentView } from '@/features/documents/document'
import {
  DROPPED_EDITS_MESSAGE,
  canRedoNow,
  canUndoNow,
  replayPending,
  shownPipeline,
} from '@/features/documents/document-session'
import type { DocumentOperation } from '@/features/documents/document-session'
import {
  InvalidChangeError,
  applyChange,
} from '@/features/pipeline/document-change'
import type { DocumentChange } from '@/features/pipeline/document-change'
import { errorMessage } from '@/lib/error-message'
import { useAppStore } from '@/store/app-store'

const SAVE_FAILED = 'The change could not be saved.'

const running = new Map<string, Promise<void>>()

function send(
  id: string,
  revision: number,
  op: DocumentOperation,
): Promise<DocumentView> {
  switch (op.kind) {
    case 'change':
      return changeDocument({ data: { id, revision, change: op.change } })
    case 'undo':
      return undoDocument({ data: { id, revision } })
    case 'redo':
      return redoDocument({ data: { id, revision } })
  }
}

/**
 * Takes a newer state from the server and makes the waiting operations again on
 * top of it, dropping any that no longer apply and saying so.
 */
function rebase(id: string, view: DocumentView): void {
  const store = useAppStore.getState()
  const session = store.documents[id]
  if (!session) return
  const { pending, dropped } = replayPending(view, session.pending)
  store.rebaseDocument(
    view,
    pending,
    dropped > 0 ? DROPPED_EDITS_MESSAGE : undefined,
  )
}

type Recovery = 'retry' | 'stop'

/**
 * Sorts out an operation the server refused. If the server's document has
 * moved on since the operation was made, it was made on out-of-date state (a
 * change from another tab landed first), so the waiting operations are made
 * again on top of the new state and sending carries on. Otherwise the server
 * meant it: the waiting operations are dropped and the reason stays on screen.
 */
async function recover(
  id: string,
  sentRevision: number,
  error: unknown,
): Promise<Recovery> {
  let latest: DocumentView
  try {
    latest = await getDocument({ data: { id } })
  } catch {
    useAppStore.getState().failDocument(id, errorMessage(error, SAVE_FAILED))
    return 'stop'
  }
  if (latest.revision > sentRevision) {
    rebase(id, latest)
    return 'retry'
  }
  const store = useAppStore.getState()
  store.failDocument(id, errorMessage(error, SAVE_FAILED))
  store.confirmDocument(latest, true)
  return 'stop'
}

async function drain(id: string): Promise<void> {
  try {
    for (;;) {
      const session = useAppStore.getState().documents[id]
      const head = session?.pending[0]
      if (!session || !head) return
      useAppStore.getState().setSyncing(id, true)
      const sentRevision = session.confirmed.revision
      try {
        const view = await send(id, sentRevision, head.op)
        useAppStore.getState().settleOperation(view)
      } catch (error) {
        if ((await recover(id, sentRevision, error)) === 'stop') return
      }
    }
  } finally {
    running.delete(id)
    useAppStore.getState().setSyncing(id, false)
  }
}

/** Sends the document's waiting operations to the server, one at a time, in order. */
function pump(id: string): Promise<void> {
  const active = running.get(id)
  if (active) return active
  const started = drain(id)
  running.set(id, started)
  return started
}

/** Resolves once every edit made so far has been sent, so what the server holds is what the editor shows. */
export function settleDocument(id: string): Promise<void> {
  return running.get(id) ?? Promise.resolve()
}

/** Reads a document from the server into the editor, unless it is already there. */
export async function loadDocument(id: string): Promise<void> {
  if (useAppStore.getState().documents[id]) return
  const view = await getDocument({ data: { id } })
  useAppStore.getState().confirmDocument(view, false)
}

/**
 * Makes one change to a document's pipeline. It shows at once and is sent after
 * the changes before it; the returned promise settles when the queue is empty.
 */
export function applyEdit(id: string, change: DocumentChange): Promise<void> {
  const store = useAppStore.getState()
  const session = store.documents[id]
  if (!session) return Promise.resolve()
  try {
    applyChange(shownPipeline(session), change)
  } catch (error) {
    if (!(error instanceof InvalidChangeError)) throw error
    store.setDocumentError(id, error.message)
    return Promise.resolve()
  }
  store.queueOperation(id, { kind: 'change', change })
  return pump(id)
}

export function undoEdit(id: string): Promise<void> {
  const store = useAppStore.getState()
  const session = store.documents[id]
  if (!session || !canUndoNow(session)) return Promise.resolve()
  store.queueOperation(id, { kind: 'undo' })
  return pump(id)
}

export function redoEdit(id: string): Promise<void> {
  const store = useAppStore.getState()
  const session = store.documents[id]
  if (!session || !canRedoNow(session)) return Promise.resolve()
  store.queueOperation(id, { kind: 'redo' })
  return pump(id)
}

/** What another tab says a document is now. */
export type RemoteVersion = Pick<DocumentView, 'revision' | 'updatedAt'>

/** Whether `remote` is a state the editor has not seen: a later revision, or the same one renamed since. */
export function isNewer(remote: RemoteVersion, held: RemoteVersion): boolean {
  if (remote.revision !== held.revision) return remote.revision > held.revision
  return remote.updatedAt > held.updatedAt
}

/**
 * Brings an open document up to date after another tab changed it. Edits made
 * here that are still on their way finish first (the server settles which came
 * first); then, if the server's document is still newer than the editor's, it
 * is read and shown. With no `remote` the server is asked whatever it holds, as
 * when a connection returns and nothing is known of what was missed. A document that is not open here is left alone: it is
 * read fresh when it is opened.
 */
export async function reconcileDocument(
  id: string,
  remote?: RemoteVersion,
): Promise<void> {
  for (;;) {
    await settleDocument(id)
    const held = useAppStore.getState().documents[id]
    if (!held || (remote && !isNewer(remote, held.confirmed))) return
    const view = await getDocument({ data: { id } })
    const now = useAppStore.getState().documents[id]
    if (!now) return
    if (running.has(id)) continue
    if (isNewer(view, now.confirmed)) rebase(id, view)
    return
  }
}
