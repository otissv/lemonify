import { useSyncExternalStore } from 'react'

const MAC_PATTERN = /Mac|iPhone|iPad|iPod/

function subscribe(): () => void {
  return () => undefined
}

/** Whether this browser runs on a Mac, where `mod` is Cmd and not Ctrl. Read when a key is pressed, never on the server. */
export function isMacPlatform(): boolean {
  return (
    typeof navigator !== 'undefined' && MAC_PATTERN.test(navigator.userAgent)
  )
}

function serverSnapshot(): boolean {
  return false
}

/** `isMacPlatform` for drawing shortcuts: the server draws the non-Mac form, so the first draw in the browser matches it and a Mac switches straight after. */
export function useIsMac(): boolean {
  return useSyncExternalStore(subscribe, isMacPlatform, serverSnapshot)
}
