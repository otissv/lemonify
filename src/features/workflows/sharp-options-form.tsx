import { useMemo } from 'react'

import { resizeKernel } from '@/features/workflows/fields/matrix-value'
import type { Dimensions } from '@/features/workflows/fields/matrix-value'
import { SharpOptionField } from '@/features/workflows/sharp-option-field'
import { sharpFieldRows } from '@/features/workflows/sharp-field-rows'
import type { OpField } from '@/features/workflows/sharp-op-fields'
import {
  sharpOpFields,
  sharpOptionProblems,
} from '@/features/workflows/sharp-op-fields'
import type { SharpStep } from '@/features/pipeline/pipeline'

type Options = SharpStep['options']

interface SharpOptionsFormProps {
  op: string
  options: Options
  onChange: (options: Options) => void
}

const GENERAL_PROBLEM = '_'

function dimensions(options: Options): Dimensions | undefined {
  const { width, height } = options
  const valid = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value > 0
  return valid(width) && valid(height) ? { width, height } : undefined
}

/**
 * A convolve kernel follows the width and height it is for. When both were
 * set before, values that still fit stay in place; when one was cleared in
 * between, the old shape is not known, so the list is cut or padded with
 * zeros to the new size.
 */
function keepKernelSized(op: string, before: Options, after: Options): Options {
  if (op !== 'convolve') return after
  const from = dimensions(before)
  const to = dimensions(after)
  const { kernel } = after
  if (!to || !Array.isArray(kernel)) return after
  const numbers = kernel.filter(
    (cell): cell is number => typeof cell === 'number',
  )
  if (from) {
    if (from.width === to.width && from.height === to.height) return after
    return { ...after, kernel: resizeKernel(numbers, from, to) }
  }
  const length = to.width * to.height
  if (numbers.length === length) return after
  return {
    ...after,
    kernel: Array.from({ length }, (_cell, index) => numbers.at(index) ?? 0),
  }
}

/** A form for one Sharp step's options; fields and checks come from the image CLI's schema. */
export function SharpOptionsForm({
  op,
  options,
  onChange,
}: SharpOptionsFormProps): React.JSX.Element {
  const fields = useMemo(() => sharpOpFields(op), [op])
  const rows = useMemo(() => sharpFieldRows(fields), [fields])
  const problems = sharpOptionProblems(op, options)
  const general = problems[GENERAL_PROBLEM]

  function handleFieldChange(
    name: string,
    value: Options[string] | undefined,
  ): void {
    const { [name]: _previous, ...rest } = options
    const next = value === undefined ? rest : { ...rest, [name]: value }
    onChange(keepKernelSized(op, options, next))
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {general && <p className="text-caption text-destructive">{general}</p>}
      {fields.length === 0 && (
        <p className="text-body-md text-muted-foreground">
          This step has no options.
        </p>
      )}
      {rows.map((row) => {
        const fieldsOfRow = row.map((field: OpField) => (
          <SharpOptionField
            key={field.name}
            field={field}
            value={options[field.name]}
            options={options}
            problem={problems[field.name]}
            onChange={handleFieldChange}
          />
        ))
        if (row.length === 1) return fieldsOfRow
        return (
          <div
            key={row.map(({ name }) => name).join(',')}
            data-slot="field-row"
            className="grid grid-cols-2 gap-3"
          >
            {fieldsOfRow}
          </div>
        )
      })}
    </div>
  )
}
