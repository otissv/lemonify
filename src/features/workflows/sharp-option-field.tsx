import { useEffect, useId, useState } from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import type { OpField } from '@/features/workflows/sharp-op-fields'
import {
  OpFieldKind,
  opFieldHasFixedRange,
  opFieldSliderStep,
} from '@/features/workflows/sharp-op-fields'
import { ColourControl } from '@/features/workflows/fields/colour-field'
import type {
  ControlProps,
  JsonValue,
} from '@/features/workflows/fields/control-props'
import {
  ImageControl,
  ImagesControl,
} from '@/features/workflows/fields/image-field'
import { MatrixControl } from '@/features/workflows/fields/matrix-field'
import { z } from 'zod'

export type SharpOptionFieldProps = Omit<ControlProps, 'id' | 'describedBy'>

const DEFAULT_CHOICE = '__default__'
const NOT_JSON = 'Enter valid JSON.'

const TEXTAREA_CLASSES =
  'min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-caption outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30'

function textOf(value: JsonValue | undefined): string {
  if (value === undefined) return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function BoundedNumberSlider({
  field,
  value,
  problem,
  onChange,
  describedBy,
}: ControlProps): React.JSX.Element {
  const unset = value === undefined
  const min = field.min!
  const max = field.max!
  const position = unset ? min : (value as number)
  const step = opFieldSliderStep(field)

  function handleValueChange(values: Array<number>): void {
    const next = values.at(0)
    if (next === undefined) return
    onChange(
      field.name,
      field.kind === OpFieldKind.Integer ? Math.round(next) : next,
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-body-md text-muted-foreground">
          {unset ? 'Default' : formatBoundedNumber(field, position)}
        </span>
      </div>
      <Slider
        thumbLabel={field.label}
        aria-required={field.required}
        aria-invalid={problem ? true : undefined}
        aria-describedby={describedBy}
        min={min}
        max={max}
        step={step}
        value={[position]}
        onValueChange={handleValueChange}
      />
    </div>
  )
}

function formatBoundedNumber(field: OpField, value: number): string {
  if (field.kind === OpFieldKind.Integer) return String(Math.round(value))
  const step = opFieldSliderStep(field)
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3
  return String(Number(value.toFixed(decimals)))
}

function NumberInput({
  field,
  value,
  problem,
  onChange,
  id,
  describedBy,
}: ControlProps): React.JSX.Element {
  const [text, setText] = useState(textOf(value))

  useEffect(() => {
    setText((typed) => {
      const typedNumber = typed === '' ? undefined : Number(typed)
      return typedNumber === value ? typed : textOf(value)
    })
  }, [value])

  function handleChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const next = event.target.value
    setText(next)
    if (next === '') {
      onChange(field.name, undefined)
      return
    }
    const number = Number(next)
    if (Number.isFinite(number)) onChange(field.name, number)
  }

  return (
    <Input
      id={id}
      type="number"
      inputMode={field.kind === OpFieldKind.Integer ? 'numeric' : 'decimal'}
      step={field.kind === OpFieldKind.Integer ? 1 : 'any'}
      min={field.min}
      max={field.max}
      required={field.required}
      value={text}
      aria-invalid={problem ? true : undefined}
      aria-describedby={describedBy}
      onChange={handleChange}
    />
  )
}

function NumberControl(props: ControlProps): React.JSX.Element {
  if (opFieldHasFixedRange(props.field)) {
    return <BoundedNumberSlider {...props} />
  }
  return <NumberInput {...props} />
}

function TextControl({
  field,
  value,
  problem,
  onChange,
  id,
  describedBy,
}: ControlProps): React.JSX.Element {
  function handleChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const next = event.target.value
    onChange(field.name, next === '' ? undefined : next)
  }

  return (
    <Input
      id={id}
      required={field.required}
      value={textOf(value)}
      aria-invalid={problem ? true : undefined}
      aria-describedby={describedBy}
      onChange={handleChange}
    />
  )
}

function ChoiceControl({
  field,
  value,
  problem,
  onChange,
  describedBy,
  labelId,
}: ControlProps & { labelId: string }): React.JSX.Element {
  function handleChange(next: string): void {
    onChange(field.name, next === DEFAULT_CHOICE ? undefined : next)
  }

  return (
    <Select
      value={typeof value === 'string' ? value : DEFAULT_CHOICE}
      onValueChange={handleChange}
    >
      <SelectTrigger
        aria-labelledby={labelId}
        aria-required={field.required}
        aria-invalid={problem ? true : undefined}
        aria-describedby={describedBy}
        className="w-full"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {!field.required && (
          <SelectItem value={DEFAULT_CHOICE}>Default</SelectItem>
        )}
        {field.choices?.map((choice) => (
          <SelectItem key={choice} value={choice}>
            {choice}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function JsonControl({
  field,
  value,
  problem,
  onChange,
  id,
  describedBy,
}: ControlProps): React.JSX.Element {
  const [text, setText] = useState(textOf(value))
  const [parseProblem, setParseProblem] = useState<string | null>(null)

  useEffect(() => {
    setText(textOf(value))
    setParseProblem(null)
  }, [value])

  function handleChange(event: React.ChangeEvent<HTMLTextAreaElement>): void {
    setText(event.target.value)
  }

  function handleBlur(): void {
    const trimmed = text.trim()
    if (trimmed === '') {
      setParseProblem(null)
      onChange(field.name, undefined)
      return
    }
    try {
      onChange(field.name, parseJsonOrText(trimmed))
      setParseProblem(null)
    } catch {
      setParseProblem(NOT_JSON)
    }
  }

  return (
    <>
      <textarea
        id={id}
        value={text}
        spellCheck={false}
        required={field.required}
        aria-invalid={problem || parseProblem ? true : undefined}
        aria-describedby={describedBy}
        className={TEXTAREA_CLASSES}
        onChange={handleChange}
        onBlur={handleBlur}
      />
      {parseProblem && (
        <p className="text-caption text-destructive">{parseProblem}</p>
      )}
    </>
  )
}

/** JSON values as typed; anything else that is not JSON-shaped is kept as a string. */
function parseJsonOrText(text: string): JsonValue {
  const looksLikeJson = /^[[{"\d-]|^(true|false|null)$/.test(text)
  if (!looksLikeJson) return text
  return z.json().parse(JSON.parse(text))
}

function Control(props: ControlProps & { labelId: string }): React.JSX.Element {
  switch (props.field.kind) {
    case OpFieldKind.Integer:
    case OpFieldKind.Number:
      return <NumberControl {...props} />
    case OpFieldKind.String:
      return <TextControl {...props} />
    case OpFieldKind.Enum:
      return <ChoiceControl {...props} />
    case OpFieldKind.Json:
      return <JsonControl {...props} />
    case OpFieldKind.Colour:
      return <ColourControl {...props} />
    case OpFieldKind.Matrix:
      return <MatrixControl {...props} />
    case OpFieldKind.Image:
      return <ImageControl {...props} />
    case OpFieldKind.Images:
      return <ImagesControl {...props} />
    case OpFieldKind.Boolean:
      return <BooleanControl {...props} />
  }
}

function BooleanControl({
  field,
  value,
  onChange,
  id,
  describedBy,
}: ControlProps): React.JSX.Element {
  function handleChange(checked: boolean): void {
    onChange(field.name, checked)
  }

  return (
    <Switch
      id={id}
      checked={value === true}
      aria-describedby={describedBy}
      onCheckedChange={handleChange}
    />
  )
}

/** One option of a Sharp step, with the image CLI's description and any problem with its value. */
export function SharpOptionField(
  props: SharpOptionFieldProps,
): React.JSX.Element {
  const { field, problem } = props
  const id = useId()
  const labelId = `${id}-label`
  const descriptionId = field.description ? `${id}-description` : undefined
  const problemId = problem ? `${id}-problem` : undefined
  const missingId =
    field.required && props.value === undefined ? `${id}-missing` : undefined
  const describedBy =
    [problemId, missingId, descriptionId].filter(Boolean).join(' ') || undefined
  const inline = field.kind === OpFieldKind.Boolean

  return (
    <div
      className={cn(
        'flex gap-2',
        inline ? 'items-center justify-between' : 'flex-col',
      )}
    >
      <Label id={labelId} htmlFor={id}>
        {field.label}
      </Label>
      <Control {...props} id={id} labelId={labelId} describedBy={describedBy} />
      {problemId && (
        <p id={problemId} className="text-caption text-destructive">
          {problem}
        </p>
      )}
      {missingId && (
        <p id={missingId} className="text-caption text-muted-foreground">
          Required.
        </p>
      )}
      {descriptionId && (
        <p id={descriptionId} className="text-caption text-muted-foreground">
          {field.description}
        </p>
      )}
    </div>
  )
}
