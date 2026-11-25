import { useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { TRANSPARENT, canvasSchema } from '@/features/pipeline/canvas'
import type { Canvas } from '@/features/pipeline/canvas'

const DEFAULT_COLOUR = '#ffffff'

interface CanvasFormProps {
  initial: Canvas
  submitLabel: string
  /** Called with a canvas that has passed the same checks the server makes. */
  onSubmit: (canvas: Canvas) => void
  disabled?: boolean
  /** The reason the last submit was refused elsewhere, such as by the server. */
  error?: string | undefined
  /** Whether the width and height can be set; when not, the canvas keeps the size it has and only its background is set. */
  sizeShown?: boolean
}

function colourOf(canvas: Canvas): string {
  return canvas.background === TRANSPARENT ? DEFAULT_COLOUR : canvas.background
}

/** The size and background of a canvas, to enter and submit. Used where a document is made and where its canvas is changed, so both check the same things. */
export function CanvasForm({
  initial,
  submitLabel,
  onSubmit,
  disabled = false,
  error,
  sizeShown = true,
}: CanvasFormProps): React.JSX.Element {
  const [width, setWidth] = useState(String(initial.width))
  const [height, setHeight] = useState(String(initial.height))
  const [transparent, setTransparent] = useState(
    initial.background === TRANSPARENT,
  )
  const [colour, setColour] = useState(colourOf(initial))
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const widthId = useId()
  const heightId = useId()
  const transparentId = useId()
  const colourId = useId()

  function handleWidth(event: React.ChangeEvent<HTMLInputElement>): void {
    setWidth(event.target.value)
  }

  function handleHeight(event: React.ChangeEvent<HTMLInputElement>): void {
    setHeight(event.target.value)
  }

  function handleColour(event: React.ChangeEvent<HTMLInputElement>): void {
    setColour(event.target.value)
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const parsed = canvasSchema.safeParse({
      width: Number(width),
      height: Number(height),
      background: transparent ? TRANSPARENT : colour,
    })
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? 'That canvas is not valid.')
      return
    }
    setProblem(undefined)
    onSubmit(parsed.data)
  }

  const shown = problem ?? error
  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
      {sizeShown && (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor={widthId}>Width (px)</Label>
            <Input
              id={widthId}
              inputMode="numeric"
              autoComplete="off"
              value={width}
              disabled={disabled}
              onChange={handleWidth}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={heightId}>Height (px)</Label>
            <Input
              id={heightId}
              inputMode="numeric"
              autoComplete="off"
              value={height}
              disabled={disabled}
              onChange={handleHeight}
            />
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Switch
          id={transparentId}
          checked={transparent}
          disabled={disabled}
          onCheckedChange={setTransparent}
        />
        <Label htmlFor={transparentId}>Transparent background</Label>
      </div>
      {!transparent && (
        <div className="flex items-center gap-2">
          <Label htmlFor={colourId}>Background colour</Label>
          <input
            id={colourId}
            type="color"
            value={colour}
            disabled={disabled}
            onChange={handleColour}
            className="h-8 w-12 cursor-pointer rounded-md border border-input bg-background"
          />
        </div>
      )}
      {shown !== undefined && (
        <p role="alert" className="text-caption text-destructive">
          {shown}
        </p>
      )}
      <Button type="submit" size="sm" disabled={disabled}>
        {submitLabel}
      </Button>
    </form>
  )
}
