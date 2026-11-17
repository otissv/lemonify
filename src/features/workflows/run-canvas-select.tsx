import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  RunCanvasMode,
  RunCanvasModeSchema,
} from '@/features/workflows/workflow'

interface RunCanvasSelectProps {
  value: RunCanvasMode
  onChange: (mode: RunCanvasMode) => void
}

const LABELS: Readonly<Record<RunCanvasMode, string>> = {
  [RunCanvasMode.Workflow]: 'Workflow canvas',
  [RunCanvasMode.FirstImage]: 'Size of each image',
}

/** Which canvas a run draws each input image on: the workflow's own, or one the size of the image. */
export function RunCanvasSelect({
  value,
  onChange,
}: RunCanvasSelectProps): React.JSX.Element {
  function handleChange(next: string): void {
    const parsed = RunCanvasModeSchema.safeParse(next)
    if (parsed.success) onChange(parsed.data)
  }

  return (
    <Select value={value} onValueChange={handleChange}>
      <SelectTrigger aria-label="Run on" size="sm" className="w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {RunCanvasModeSchema.options.map((mode) => (
          <SelectItem key={mode} value={mode}>
            {LABELS[mode]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
