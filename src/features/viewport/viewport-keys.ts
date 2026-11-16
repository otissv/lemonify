import type { KeyboardEvent } from 'react'

import type { ViewportActions } from '@/features/viewport/use-viewport'

/** How far an arrow key moves the picture, in screen pixels; Shift moves four times as far. */
export const KEY_PAN_STEP = 40
const SHIFT_MULTIPLIER = 4

/**
 * The keys that move around the picture, the same wherever the view is shown:
 * + and - zoom, 0 fits, 1 shows actual size, and the arrow keys pan. Returns
 * whether the key was one of them, so the caller can stop the browser reacting
 * as well.
 */
export function handleViewportKey(
  event: Pick<
    KeyboardEvent,
    'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'
  >,
  actions: ViewportActions,
): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false
  const step = event.shiftKey ? KEY_PAN_STEP * SHIFT_MULTIPLIER : KEY_PAN_STEP
  switch (event.key) {
    case '+':
    case '=':
      actions.zoomIn()
      return true
    case '-':
    case '_':
      actions.zoomOut()
      return true
    case '0':
      actions.fit()
      return true
    case '1':
      actions.actualSize()
      return true
    case 'ArrowLeft':
      actions.panBy(step, 0)
      return true
    case 'ArrowRight':
      actions.panBy(-step, 0)
      return true
    case 'ArrowUp':
      actions.panBy(0, step)
      return true
    case 'ArrowDown':
      actions.panBy(0, -step)
      return true
    default:
      return false
  }
}
