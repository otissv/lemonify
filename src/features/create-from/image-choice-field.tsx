import { useId } from 'react'

import {
  ImageChoice,
  ImageChoiceSchema,
} from '@/features/workflows/create-from'

const CHOICES: ReadonlyArray<{
  value: ImageChoice
  label: string
  hint: string
}> = [
  {
    value: ImageChoice.RemoveInput,
    label: 'Remove only the input image',
    hint: 'The first image layer’s image becomes the input; the others stay.',
  },
  {
    value: ImageChoice.Remove,
    label: 'Remove all images',
    hint: 'Every image becomes an input image, and every image layer is empty.',
  },
  {
    value: ImageChoice.Keep,
    label: 'Keep all images',
    hint: 'Every image layer keeps its image; add input images later.',
  },
]

interface ImageChoiceFieldProps {
  value: ImageChoice
  disabled: boolean
  onChange: (choice: ImageChoice) => void
}

/** What a new workflow does with the images of the document it is made from. */
export function ImageChoiceField({
  value,
  disabled,
  onChange,
}: ImageChoiceFieldProps): React.JSX.Element {
  const name = useId()

  function handleChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const parsed = ImageChoiceSchema.safeParse(event.target.value)
    if (parsed.success) onChange(parsed.data)
  }

  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-1 text-body-md font-medium">Images</legend>
      {CHOICES.map((choice) => (
        <label key={choice.value} className="flex items-start gap-2">
          <input
            type="radio"
            name={name}
            value={choice.value}
            checked={value === choice.value}
            onChange={handleChange}
            className="mt-1 accent-primary"
          />
          <span className="flex flex-col">
            <span className="text-body-md">{choice.label}</span>
            <span className="text-body-sm text-muted-foreground">
              {choice.hint}
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  )
}
