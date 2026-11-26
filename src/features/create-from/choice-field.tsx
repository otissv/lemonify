import { useId } from 'react'

export type Choice = { value: string; label: string }

interface ChoiceFieldProps {
  label: string
  value: string
  choices: ReadonlyArray<Choice>
  disabled: boolean
  onChange: (value: string) => void
}

/** One choice from a short list, with its label. */
export function ChoiceField({
  label,
  value,
  choices,
  disabled,
  onChange,
}: ChoiceFieldProps): React.JSX.Element {
  const id = useId()

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>): void {
    onChange(event.target.value)
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-body-md font-medium">
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={handleChange}
        className="h-9 rounded-md border border-input bg-transparent px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </div>
  )
}
