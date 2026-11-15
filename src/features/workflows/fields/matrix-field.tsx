import { useEffect, useState } from 'react'

import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ControlProps } from '@/features/workflows/fields/control-props'
import {
  identityMatrix,
  readMatrix,
  writeMatrix,
} from '@/features/workflows/fields/matrix-value'
import type { Matrix } from '@/features/workflows/fields/matrix-value'
import type { MatrixSpec } from '@/features/workflows/sharp-op-fields'

interface Grid {
  rows: number
  cols: number
  layout: 'nested' | 'flat'
}

interface MatrixGridProps {
  label: string
  grid: Grid
  value: ControlProps['value']
  describedBy: string | undefined
  invalid: boolean
  onMatrix: (matrix: Matrix) => void
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined
}

function emptyMatrix(grid: Grid, spec: MatrixSpec): Matrix {
  if (spec.kind === 'kernel')
    return Array.from({ length: grid.rows }, () =>
      Array.from({ length: grid.cols }, () => 0),
    )
  return identityMatrix(grid.rows)
}

function textsOf(matrix: Matrix): Array<Array<string>> {
  return matrix.map((row) => row.map(String))
}

function numbersOf(
  texts: ReadonlyArray<ReadonlyArray<string>>,
): Matrix | undefined {
  const matrix: Matrix = []
  for (const row of texts) {
    const numbers: Array<number> = []
    for (const text of row) {
      if (text.trim() === '' || !Number.isFinite(Number(text))) return undefined
      numbers.push(Number(text))
    }
    matrix.push(numbers)
  }
  return matrix
}

function MatrixGrid({
  label,
  grid,
  value,
  describedBy,
  invalid,
  spec,
  onMatrix,
}: MatrixGridProps & { spec: MatrixSpec }): React.JSX.Element {
  const known = readMatrix(value, grid.rows, grid.cols)
  const [texts, setTexts] = useState(() =>
    textsOf(known ?? emptyMatrix(grid, spec)),
  )

  useEffect(() => {
    setTexts((typed) => {
      const matrix = known ?? emptyMatrix(grid, spec)
      const same = JSON.stringify(numbersOf(typed)) === JSON.stringify(matrix)
      return same ? typed : textsOf(matrix)
    })
  }, [known, grid, spec])

  function handleCell(row: number, col: number, text: string): void {
    const next = texts.map((cells, y) =>
      cells.map((cell, x) => (y === row && x === col ? text : cell)),
    )
    setTexts(next)
    const matrix = numbersOf(next)
    if (matrix) onMatrix(matrix)
  }

  return (
    <fieldset
      aria-label={label}
      aria-describedby={describedBy}
      className="m-0 grid min-w-0 gap-1 border-0 p-0"
      style={{ gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))` }}
    >
      {texts.map((cells, row) =>
        cells.map((text, col) => (
          <Input
            // biome-ignore lint/suspicious/noArrayIndexKey: cells are a fixed grid and have no other identity
            key={`${row}-${col}`}
            type="number"
            step="any"
            inputMode="decimal"
            aria-label={`Row ${row + 1}, column ${col + 1}`}
            aria-invalid={invalid ? true : undefined}
            className="px-2 text-center"
            value={text}
            onChange={(event) => {
              handleCell(row, col, event.target.value)
            }}
          />
        )),
      )}
    </fieldset>
  )
}

function sizeOf(
  value: ControlProps['value'],
  sizes: ReadonlyArray<number>,
): number {
  for (const size of sizes) {
    if (readMatrix(value, size, size)) return size
  }
  return sizes[0]
}

/** A matrix as a grid of numbers: a fixed size, a choice of sizes, or a kernel as wide and high as the step says. */
export function MatrixControl({
  field,
  value,
  options,
  problem,
  onChange,
  describedBy,
}: ControlProps): React.JSX.Element {
  const spec = field.matrix
  const width = positiveInt(options.width)
  const height = positiveInt(options.height)

  if (!spec) throw new TypeError(`${field.name} has no matrix layout`)

  function handleMatrix(grid: Grid, matrix: Matrix): void {
    onChange(field.name, writeMatrix(matrix, grid.layout))
  }

  if (spec.kind === 'kernel') {
    if (width === undefined || height === undefined)
      return (
        <p className="text-caption text-muted-foreground">
          Set width and height to edit the kernel.
        </p>
      )
    const grid: Grid = { rows: height, cols: width, layout: 'flat' }
    return (
      <MatrixGrid
        label={field.label}
        grid={grid}
        spec={spec}
        value={value}
        describedBy={describedBy}
        invalid={problem !== undefined}
        onMatrix={(matrix) => {
          handleMatrix(grid, matrix)
        }}
      />
    )
  }

  const sizes = spec.kind === 'fixed' ? [spec.size] : spec.sizes
  const size = sizeOf(value, sizes)
  const grid: Grid = { rows: size, cols: size, layout: 'nested' }

  function handleSize(next: string): void {
    onChange(field.name, identityMatrix(Number(next)))
  }

  return (
    <div className="flex flex-col gap-2">
      {sizes.length > 1 && (
        <Select value={String(size)} onValueChange={handleSize}>
          <SelectTrigger aria-label={`${field.label} size`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sizes.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {option} × {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <MatrixGrid
        key={size}
        label={field.label}
        grid={grid}
        spec={spec}
        value={value}
        describedBy={describedBy}
        invalid={problem !== undefined}
        onMatrix={(matrix) => {
          handleMatrix(grid, matrix)
        }}
      />
    </div>
  )
}
