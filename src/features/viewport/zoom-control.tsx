import { RiImageLine } from '@remixicon/react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { useActionHint } from '@/features/keybindings/use-action-hint'
import { useViewport } from '@/features/viewport/use-viewport'
import {
  formatPercent,
  parsePercent,
  positionForZoom,
} from '@/features/viewport/viewport'
import { cn } from '@/lib/utils'

interface ZoomControlProps {
  documentId: string
  className?: string
}

const SLIDER_STEPS = 1000

/**
 * The zoom, as in Photoshop's Navigator: a percentage to type into, and a
 * slider with a small picture at one end to zoom out and a large one at the
 * other to zoom in. The canvas and the Navigator panel both show this, over
 * the same view.
 */
export function ZoomControl({
  documentId,
  className,
}: ZoomControlProps): React.JSX.Element {
  const view = useViewport(documentId)
  const [draft, setDraft] = useState<string | undefined>(undefined)
  const disabled = view.frame === undefined || view.limits === undefined
  const shown =
    draft ?? (view.percent === undefined ? '' : formatPercent(view.percent))
  const position =
    view.limits === undefined
      ? 0
      : positionForZoom(view.viewport.zoom, view.limits)

  function handleChange(event: React.ChangeEvent<HTMLInputElement>): void {
    setDraft(event.target.value)
  }

  function handleCommit(): void {
    if (draft === undefined) return
    const percent = parsePercent(draft)
    if (percent !== undefined) view.zoomToPercent(percent)
    setDraft(undefined)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    event.stopPropagation()
    if (event.key === 'Enter') handleCommit()
    if (event.key === 'Escape') setDraft(undefined)
  }

  const zoomOutHint = useActionHint('view.zoomOut')
  const zoomInHint = useActionHint('view.zoomIn')

  function handleSlide(values: number[]): void {
    const [next] = values
    if (next !== undefined) view.zoomToPosition(next)
  }

  return (
    <div
      data-slot="zoom-control"
      className={cn('flex items-center gap-2', className)}
    >
      <Input
        aria-label="Zoom"
        inputMode="decimal"
        autoComplete="off"
        value={shown}
        disabled={disabled}
        onChange={handleChange}
        onBlur={handleCommit}
        onKeyDown={handleKeyDown}
        className="h-7 w-16 shrink-0 px-1 text-center md:text-xs"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Zoom out"
        title={zoomOutHint.titled('Zoom out')}
        aria-keyshortcuts={zoomOutHint.aria}
        disabled={disabled}
        onClick={view.zoomOut}
      >
        <RiImageLine aria-hidden="true" className="size-3" />
      </Button>
      <Slider
        thumbLabel="Zoom level"
        min={0}
        max={1}
        step={1 / SLIDER_STEPS}
        value={[position]}
        disabled={disabled}
        onValueChange={handleSlide}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Zoom in"
        title={zoomInHint.titled('Zoom in')}
        aria-keyshortcuts={zoomInHint.aria}
        disabled={disabled}
        onClick={view.zoomIn}
      >
        <RiImageLine aria-hidden="true" className="size-5" />
      </Button>
    </div>
  )
}
