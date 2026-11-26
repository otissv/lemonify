import { useId } from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface NameFieldProps {
  value: string
  disabled: boolean
  onChange: (name: string) => void
}

/** The new item's name, which starts as the suggested one and can be changed. */
export function NameField({
  value,
  disabled,
  onChange,
}: NameFieldProps): React.JSX.Element {
  const id = useId()

  function handleChange(event: React.ChangeEvent<HTMLInputElement>): void {
    onChange(event.target.value)
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>Name</Label>
      <Input
        id={id}
        value={value}
        disabled={disabled}
        autoComplete="off"
        onChange={handleChange}
      />
    </div>
  )
}
