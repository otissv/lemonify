import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { RealtimeStatus } from '@/features/realtime/realtime-client'
import { useAppStore } from '@/store/app-store'

/** A brief loss of connection is not worth mentioning; a longer one is. */
export const RECONNECT_NOTICE_DELAY_MS = 3000
export const RECONNECTING_MESSAGE =
  'Reconnecting to live updates. Changes made in other tabs will show once it is back.'

/** Says when live updates are down for a while, and what happened elsewhere that the person should know. */
export function LiveStatus(): React.JSX.Element | null {
  const status = useAppStore((state) => state.realtime)
  const notice = useAppStore((state) => state.liveNotice)
  const setLiveNotice = useAppStore((state) => state.setLiveNotice)
  const reconnecting = status === RealtimeStatus.Reconnecting
  const [late, setLate] = useState(false)

  useEffect(() => {
    if (!reconnecting) {
      setLate(false)
      return
    }
    const timer = setTimeout(() => setLate(true), RECONNECT_NOTICE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [reconnecting])

  const message =
    notice ?? (reconnecting && late ? RECONNECTING_MESSAGE : undefined)
  if (message === undefined) return null

  function handleDismiss(): void {
    setLiveNotice(undefined)
  }

  return (
    <div
      role="status"
      className="absolute bottom-3 left-3 z-20 flex max-w-96 items-center gap-2 rounded-lg border border-border bg-card p-2 text-caption shadow-xs"
    >
      <span>{message}</span>
      {notice === undefined ? null : (
        <Button type="button" size="sm" variant="ghost" onClick={handleDismiss}>
          Dismiss
        </Button>
      )}
    </div>
  )
}
