export interface PanelPosition {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export const PANEL_MARGIN = 16
export const KEYBOARD_STEP = 16
export const KEYBOARD_STEP_LARGE = 64

function clamp(value: number, max: number): number {
  return Math.min(Math.max(value, 0), Math.max(max, 0))
}

/** Keeps a panel of `panel` size fully inside a container of `container` size. */
export function clampPosition(
  position: PanelPosition,
  panel: Size,
  container: Size,
): PanelPosition {
  return {
    x: clamp(position.x, container.width - panel.width),
    y: clamp(position.y, container.height - panel.height),
  }
}

/** Where the panel sits before it is first moved: the top-right corner. */
export function defaultPosition(panel: Size, container: Size): PanelPosition {
  return clampPosition(
    { x: container.width - panel.width - PANEL_MARGIN, y: PANEL_MARGIN },
    panel,
    container,
  )
}

const KEY_DIRECTIONS: Readonly<Record<string, PanelPosition | undefined>> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
}

/** The position after an arrow key press, or null for any other key. */
export function nudgePosition(
  position: PanelPosition,
  key: string,
  large: boolean,
): PanelPosition | null {
  const direction = KEY_DIRECTIONS[key]
  if (!direction) return null
  const step = large ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP
  return {
    x: position.x + direction.x * step,
    y: position.y + direction.y * step,
  }
}
