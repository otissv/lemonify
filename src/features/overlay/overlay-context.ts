import { createContext, useContext } from 'react'

import type { Size } from '@/features/overlay/box-geometry'

export interface OverlayContextValue {
  /** The picture the tool acts on, in its own pixels; what the tool's numbers are measured in. */
  size: Size
  /** Screen pixels per picture pixel at the zoom the picture is shown at, so a drag of the pointer is a drag of the picture. */
  scale: number
}

export const OverlayContext = createContext<OverlayContextValue | undefined>(
  undefined,
)

/** Where the picture is and how big, for a tool drawn on it. Only valid inside the overlay layer. */
export function useOverlay(): OverlayContextValue {
  const value = useContext(OverlayContext)
  if (!value) {
    throw new Error('An overlay tool is drawn only inside the overlay layer.')
  }
  return value
}
