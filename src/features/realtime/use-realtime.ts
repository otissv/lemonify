import { useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'

import { createRealtimeClient } from '@/features/realtime/realtime-client'
import type { RealtimeClient } from '@/features/realtime/realtime-client'
import { getRealtimeUrl } from '@/features/realtime/realtime-functions'
import { createRealtimeSync } from '@/features/realtime/realtime-sync'
import { RealtimeStatus } from '@/features/realtime/realtime-client'
import { useUiStore } from '@/store/ui-store'

const ITEM_PATH = /^\/(?:documents|workflows)\/([^/]+)/

/** The document or workflow a path shows, if it shows one. */
export function itemIdFromPath(pathname: string): string | undefined {
  const id = ITEM_PATH.exec(pathname)?.[1]
  return id === undefined ? undefined : decodeURIComponent(id)
}

/**
 * Keeps this tab in step with the person's other tabs: opens the live
 * connection while the tab is mounted, applies what it hears, and catches up
 * on everything when the connection returns, the tab is shown again or the
 * network comes back.
 */
export function useRealtime(): void {
  const router = useRouter()

  useEffect(() => {
    let client: RealtimeClient | undefined
    let stopped = false
    const store = useUiStore.getState()
    const sync = createRealtimeSync({
      invalidate: () => router.invalidate(),
      openItemId: () => itemIdFromPath(router.state.location.pathname),
      leaveItem: () => {
        void router.navigate({ to: '/' })
      },
    })

    function handleWake(): void {
      if (document.visibilityState === 'hidden') return
      if (useUiStore.getState().realtime === RealtimeStatus.Open) {
        void sync.catchUp()
        return
      }
      client?.retryNow()
    }

    getRealtimeUrl()
      .then((url) => {
        if (stopped) return
        client = createRealtimeClient({
          url,
          onEvent: sync.handle,
          onStatus: store.setRealtime,
          onOpen: () => {
            void sync.catchUp()
          },
        })
        client.start()
      })
      .catch(() => {
        store.setRealtime(RealtimeStatus.Stopped)
      })

    document.addEventListener('visibilitychange', handleWake)
    window.addEventListener('online', handleWake)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', handleWake)
      window.removeEventListener('online', handleWake)
      client?.stop()
      store.setRealtime(RealtimeStatus.Stopped)
    }
  }, [router])
}
