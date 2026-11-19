import { useCallback, useEffect, useState } from 'react'

import { useOverlay } from '@/features/overlay/overlay-context'
import { useBoxDrag } from '@/features/overlay/use-box-drag'
import { guidePath, parseOverlayGuide } from '@/features/overlay/grid-guides'
import { useUiStore } from '@/store/ui-store'
import { sameBox } from '@/features/overlay/box-geometry'
import type { Box, BoxHandle } from '@/features/overlay/box-geometry'
import { cn } from '@/lib/utils'

interface BoxEditorProps {
  /** What the box is of, in a few words: "Extract region". Names the controls for a screen reader. */
  label: string
  /** The box as it is saved. */
  box: Box
  /** Called once with the new box when a drag ends or an arrow key is pressed. */
  onCommit: (box: Box) => void
}

interface HandleSpec {
  handle: Exclude<BoxHandle, 'move'>
  name: string
  position: string
  cursor: string
}

const HANDLES: ReadonlyArray<HandleSpec> = [
  {
    handle: 'nw',
    name: 'top-left corner',
    position: 'left-0 top-0',
    cursor: 'cursor-nwse-resize',
  },
  {
    handle: 'n',
    name: 'top edge',
    position: 'left-1/2 top-0',
    cursor: 'cursor-ns-resize',
  },
  {
    handle: 'ne',
    name: 'top-right corner',
    position: 'left-full top-0',
    cursor: 'cursor-nesw-resize',
  },
  {
    handle: 'e',
    name: 'right edge',
    position: 'left-full top-1/2',
    cursor: 'cursor-ew-resize',
  },
  {
    handle: 'se',
    name: 'bottom-right corner',
    position: 'left-full top-full',
    cursor: 'cursor-nwse-resize',
  },
  {
    handle: 's',
    name: 'bottom edge',
    position: 'left-1/2 top-full',
    cursor: 'cursor-ns-resize',
  },
  {
    handle: 'sw',
    name: 'bottom-left corner',
    position: 'left-0 top-full',
    cursor: 'cursor-nesw-resize',
  },
  {
    handle: 'w',
    name: 'left edge',
    position: 'left-0 top-1/2',
    cursor: 'cursor-ew-resize',
  },
]

const MOVE_HINT =
  'Drag to move. Arrow keys move it by 1 pixel, or 10 with Shift. Use the fields to set its size.'

function percent(value: number, whole: number): string {
  return `${(value / whole) * 100}%`
}

/**
 * A box on the picture that can be moved and resized by its handles, for any
 * tool whose settings are a region. It draws the box over the picture, dims
 * what is outside it, and keeps the handles one size on screen at every zoom.
 * While a drag goes on it shows the box as it would be; one change is saved
 * when it ends. Tools supply the box and what saving means.
 */
export function BoxEditor({
  label,
  box,
  onCommit,
}: BoxEditorProps): React.JSX.Element {
  const { size, scale } = useOverlay()
  const [draft, setDraft] = useState<Box | undefined>(undefined)

  // biome-ignore lint/correctness/useExhaustiveDependencies: a saved box that changed, from here or elsewhere, ends the draft
  useEffect(() => {
    setDraft(undefined)
  }, [box.left, box.top, box.width, box.height])

  const handleDraft = useCallback(
    (next: Box): void => {
      setDraft(sameBox(next, box) ? undefined : next)
    },
    [box],
  )

  const bind = useBoxDrag({
    box,
    bounds: size,
    scale,
    onDraft: handleDraft,
    onCommit,
  })
  const shown = draft ?? box
  const guide = parseOverlayGuide(useUiStore((state) => state.overlayGuide))
  const guideLines = guidePath(guide, shown.width, shown.height)
  const dragging = draft !== undefined

  return (
    <div
      data-testid="overlay-box"
      data-slot="overlay-box"
      className="absolute"
      style={{
        left: percent(shown.left, size.width),
        top: percent(shown.top, size.height),
        width: percent(shown.width, size.width),
        height: percent(shown.height, size.height),
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 shadow-[0_0_0_100vmax_rgb(0_0_0/0.5)] outline-solid outline-white mix-blend-normal [outline-width:calc(1.5px*var(--inverse-zoom,1))]"
      />
      {guideLines !== '' && (
        <svg
          aria-hidden="true"
          data-testid="overlay-guide"
          viewBox={`0 0 ${shown.width} ${shown.height}`}
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 size-full overflow-visible"
        >
          <path
            d={guideLines}
            fill="none"
            stroke="white"
            strokeOpacity="0.7"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
      <button
        type="button"
        aria-label={`Move ${label.toLowerCase()}`}
        aria-description={MOVE_HINT}
        className="pointer-events-auto absolute inset-0 cursor-move touch-none outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
        {...bind('move')}
      />
      {HANDLES.map(({ handle, name, position, cursor }) => (
        <button
          key={handle}
          type="button"
          tabIndex={-1}
          aria-label={`Resize ${label.toLowerCase()} from the ${name}`}
          className={cn(
            'pointer-events-auto absolute size-3 -translate-1/2 scale-(--inverse-zoom) touch-none rounded-xs border border-black/60 bg-white shadow-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring',
            position,
            cursor,
          )}
          {...bind(handle)}
        />
      ))}
      {dragging && (
        <div
          aria-hidden="true"
          data-testid="overlay-readout"
          className="pointer-events-none absolute top-full left-0 mt-2 origin-top-left scale-(--inverse-zoom) rounded-sm bg-black/75 px-1.5 py-0.5 text-caption whitespace-nowrap text-white tabular-nums"
        >
          {shown.width} × {shown.height}
        </div>
      )}
    </div>
  )
}
