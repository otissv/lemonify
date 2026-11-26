import { reconcilePipeline } from '@/features/pipeline/pipeline-sync'
import { forgetItem } from '@/store/forget-item'
import { useLibraryStore } from '@/store/library-store'
import { usePipelineStore } from '@/store/pipeline-store'
import { useUiStore } from '@/store/ui-store'
import type { RealtimeEvent } from '@/features/realtime/realtime-events'

export const DELETED_NOTICE = 'This was deleted in another tab or window.'

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
  openItemId: () => string | undefined
  /** Moves away from a document or workflow that no longer exists. */
  leaveItem: () => void
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
    remote?: Parameters<typeof reconcilePipeline>[1],
  ): Promise<void> {
    return reconcilePipeline(documentId, remote).catch(() => undefined)
  }

  function forgetDeleted(id: string): void {
    forgetItem(id)
    if (options.openItemId() !== id) return
    options.leaveItem()
    useUiStore.getState().setLiveNotice(DELETED_NOTICE)
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
        case 'workflow.updated':
          void reconcile(event.workflowId, {
            revision: event.revision,
            updatedAt: event.updatedAt,
          })
          return
        case 'document.deleted':
          forgetDeleted(event.documentId)
          return
        case 'workflow.deleted':
          forgetDeleted(event.workflowId)
          return
        case 'picture.changed':
          usePipelineStore.getState().pictureChanged(event.itemId)
          return
        case 'results.changed':
          void useLibraryStore.getState().refreshResults()
          return
        case 'heartbeat':
          return
      }
    },
    async catchUp() {
      await Promise.all([
        lists.request(),
        useLibraryStore.getState().refreshResults(),
        ...Object.keys(usePipelineStore.getState().sessions).map((id) =>
          reconcile(id),
        ),
      ])
    },
  }
}
