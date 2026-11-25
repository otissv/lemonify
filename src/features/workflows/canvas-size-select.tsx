import { useId } from 'react'

import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CanvasSize, CanvasSizeSchema } from '@/features/workflows/workflow'

interface CanvasSizeSelectProps {
  value: CanvasSize
  onChange: (canvasSize: CanvasSize) => void
}

const LABELS: Readonly<Record<CanvasSize, string>> = {
  [CanvasSize.MatchInput]: 'Match each input image',
  [CanvasSize.Fixed]: 'Set size',
}

const HINTS: Readonly<Record<CanvasSize, string>> = {
  [CanvasSize.MatchInput]:
    'Each image is drawn on a canvas of its own size, as when it is opened as a document.',
  [CanvasSize.Fixed]: 'Every image is drawn on a canvas of the size below.',
}

/** Whether a workflow's canvas takes each input image's size or keeps one of its own. */
export function CanvasSizeSelect({
  value,
  onChange,
}: CanvasSizeSelectProps): React.JSX.Element {
  const labelId = useId()
  const hintId = useId()

  function handleChange(next: string): void {
    const parsed = CanvasSizeSchema.safeParse(next)
    if (parsed.success) onChange(parsed.data)
  }

  return (
    <div className="flex flex-col gap-1">
      <Label id={labelId}>Canvas size</Label>
      <Select value={value} onValueChange={handleChange}>
        <SelectTrigger
          aria-labelledby={labelId}
          aria-describedby={hintId}
          className="w-full"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CanvasSizeSchema.options.map((option) => (
            <SelectItem key={option} value={option}>
              {LABELS[option]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p id={hintId} className="text-caption text-muted-foreground">
        {HINTS[value]}
      </p>
    </div>
  )
}
