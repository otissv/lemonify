import { reconcileDocument } from '@/features/documents/document-sync'
import type { RealtimeEvent } from '@/features/realtime/realtime-events'
import { useAppStore } from '@/store/app-store'

export const DELETED_NOTICE =
  'This document was deleted in another tab or window.'

export type ListRefresher = {
  /** Reads the lists again. Asks that arrive while one read is running share one more read. */
  request(): Promise<void>
}

/** Collapses a burst of "something changed" into as few reads as will leave the lists current. */
export function createListRefresher(
  invalidate: () => Promise<void> | void,
): ListRefresher {
  let running: Promise<void> | undefined
  let again = false

  async function run(): Promise<void> {
    do {
      again = false
      try {
        await invalidate()
      } catch {
        // The next change or reconnection reads again.
      }
    } while (again)
    running = undefined
  }

  return {
    request() {
      if (running) {
        again = true
        return running
      }
      running = run()
      return running
    },
  }
}

export type RealtimeSyncOptions = {
  invalidate: () => Promise<void> | void
  openDocumentId: () => string | undefined
  /** Moves away from a document that no longer exists. */
  leaveDocument: () => void
}

export type RealtimeSync = {
  handle(event: RealtimeEvent): void
  /** Reads everything this tab shows, after a time with no connection or no focus. */
  catchUp(): Promise<void>
}

/** What each realtime event does to this tab. Events only say what changed; the content is read through the usual authorised calls. */
export function createRealtimeSync(options: RealtimeSyncOptions): RealtimeSync {
  const lists = createListRefresher(options.invalidate)

  function reconcile(
    documentId: string,
    remote?: Parameters<typeof reconcileDocument>[1],
  ): Promise<void> {
    return reconcileDocument(documentId, remote).catch(() => undefined)
  }

  return {
    handle(event) {
      switch (event.type) {
        case 'documents.changed':
        case 'workflows.changed':
        case 'keybindings.changed':
          void lists.request()
          return
        case 'document.updated':
          void reconcile(event.documentId, {
            revision: event.revision,
            updatedAt: event.updatedAt,
          })
          return
        case 'document.deleted': {
          const store = useAppStore.getState()
          store.forgetDocument(event.documentId)
          if (options.openDocumentId() === event.documentId) {
            options.leaveDocument()
            store.setLiveNotice(DELETED_NOTICE)
          }
          return
        }
        case 'results.changed':
          useAppStore.getState().bumpResults()
          return
        case 'heartbeat':
          return
      }
    },
    async catchUp() {
      const store = useAppStore.getState()
      store.bumpResults()
      await Promise.all([
        lists.request(),
        ...Object.keys(store.documents).map((id) => reconcile(id)),
      ])
    },
  }
}
