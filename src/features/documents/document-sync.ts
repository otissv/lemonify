import {
  changeDocument,
  getDocument,
  redoDocument,
  undoDocument,
} from '@/features/documents/document-functions'
import type { DocumentView } from '@/features/documents/document'
import {
  canRedoNow,
  canUndoNow,
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

/** Puts the server's own state back after an operation it refused, keeping the reason on screen. */
async function recover(id: string, error: unknown): Promise<void> {
  const store = useAppStore.getState()
  store.failDocument(id, errorMessage(error, SAVE_FAILED))
  try {
    useAppStore
      .getState()
      .confirmDocument(await getDocument({ data: { id } }), true)
  } catch {
    // The reason above stays; the next load of the page reads the document again.
  }
}

async function drain(id: string): Promise<void> {
  try {
    for (;;) {
      const session = useAppStore.getState().documents[id]
      const head = session?.pending[0]
      if (!session || !head) return
      useAppStore.getState().setSyncing(id, true)
      try {
        const view = await send(id, session.confirmed.revision, head.op)
        useAppStore.getState().settleOperation(view)
      } catch (error) {
        await recover(id, error)
        return
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
