/** How far a pan key moves the picture, in screen pixels. */
export const KEY_PAN_STEP = 40

/** How many times further the "far" pan keys move it. */
export const FAR_PAN_MULTIPLIER = 4

export type PanStep = readonly [dx: number, dy: number, far: boolean]

/** Which way each pan action moves the view, shared by its keys and its buttons. */
export const PAN_STEPS: Readonly<Record<string, PanStep>> = {
  'view.panLeft': [1, 0, false],
  'view.panRight': [-1, 0, false],
  'view.panUp': [0, 1, false],
  'view.panDown': [0, -1, false],
  'view.panLeftFar': [1, 0, true],
  'view.panRightFar': [-1, 0, true],
  'view.panUpFar': [0, 1, true],
  'view.panDownFar': [0, -1, true],
}

/** How far a pan action moves the picture, in screen pixels, as [dx, dy]. */
export function panDistance(step: PanStep): readonly [number, number] {
  const [dx, dy, far] = step
  const distance = far ? KEY_PAN_STEP * FAR_PAN_MULTIPLIER : KEY_PAN_STEP
  return [dx * distance, dy * distance]
}
