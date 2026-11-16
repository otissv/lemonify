import { useEffect, useId, useState } from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MAX_STEP_NAME_LENGTH } from '@/features/pipeline/pipeline'

interface StepNameFieldProps {
  /** The name the step was given, if any. */
  name: string | undefined
  /** What the step is called without a name: its tool's name. */
  fallback: string
  /** Called with the new name when it is committed; an empty name clears it. */
  onRename: (name: string) => void
}

/** Renames a step. The name is committed when the field is left or Enter is pressed, so typing is one undo entry. */
export function StepNameField({
  name,
  fallback,
  onRename,
}: StepNameFieldProps): React.JSX.Element {
  const id = useId()
  const committed = name ?? ''
  const [text, setText] = useState(committed)

  useEffect(() => {
    setText(committed)
  }, [committed])

  function commit(): void {
    const next = text.trim()
    setText(next)
    if (next !== committed) onRename(next)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') commit()
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>Name</Label>
      <Input
        id={id}
        value={text}
        placeholder={fallback}
        maxLength={MAX_STEP_NAME_LENGTH}
        onChange={(event) => {
          setText(event.target.value)
        }}
        onBlur={commit}
        onKeyDown={handleKeyDown}
      />
    </div>
  )
}
