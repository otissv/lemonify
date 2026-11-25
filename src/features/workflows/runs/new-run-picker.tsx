import { RiPlayLine } from '@remixicon/react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { sourceImageUrl } from '@/features/documents/image-urls'
import { imageCount } from '@/features/workflows/runs/run-text'

interface NewRunPickerProps {
  inputs: ReadonlyArray<string>
  imageName: (sourceId: string) => string
  onRun: (sourceIds: string[]) => void
  /** Leaves the picker without running; none when there is nothing to go back to. */
  onCancel?: () => void
}

interface PickerRowProps {
  sourceId: string
  name: string
  chosen: boolean
  onToggle: (sourceId: string, chosen: boolean, range: boolean) => void
}

function PickerRow({
  sourceId,
  name,
  chosen,
  onToggle,
}: PickerRowProps): React.JSX.Element {
  const shiftRef = useRef(false)

  function handleClick(event: React.MouseEvent<HTMLInputElement>): void {
    shiftRef.current = event.shiftKey
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>): void {
    onToggle(sourceId, event.target.checked, shiftRef.current)
    shiftRef.current = false
  }

  return (
    <li>
      <label className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent">
        <input
          type="checkbox"
          checked={chosen}
          onClick={handleClick}
          onChange={handleChange}
          className="size-4 accent-primary"
        />
        <img
          src={sourceImageUrl(sourceId)}
          alt=""
          loading="lazy"
          className="size-8 shrink-0 rounded-sm object-cover"
        />
        <span className="truncate text-body-md">{name}</span>
      </label>
    </li>
  )
}

function SelectAll({
  chosen,
  total,
  onChange,
}: {
  chosen: number
  total: number
  onChange: (chosen: boolean) => void
}): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const all = total > 0 && chosen === total

  useEffect(() => {
    if (ref.current !== null) {
      ref.current.indeterminate = chosen > 0 && chosen < total
    }
  }, [chosen, total])

  function handleChange(): void {
    onChange(!all)
  }

  return (
    <label className="flex items-center gap-2 px-2 text-body-md">
      <input
        ref={ref}
        type="checkbox"
        checked={all}
        disabled={total === 0}
        onChange={handleChange}
        className="size-4 accent-primary"
      />
      Select all
    </label>
  )
}

function matches(name: string, query: string): boolean {
  return name.toLowerCase().includes(query.trim().toLowerCase())
}

/**
 * Choosing which of the workflow's input images a new run goes over: every one
 * is chosen at first, a search narrows the list, Select all chooses or clears
 * what is shown, and Shift with a click sets every image from the last one
 * clicked to this one.
 */
export function NewRunPicker({
  inputs,
  imageName,
  onRun,
  onCancel,
}: NewRunPickerProps): React.JSX.Element {
  const headingId = useId()
  const [query, setQuery] = useState('')
  const [left, setLeft] = useState<ReadonlySet<string>>(new Set())
  const anchorRef = useRef<string | undefined>(undefined)

  const shown = useMemo(
    () => inputs.filter((sourceId) => matches(imageName(sourceId), query)),
    [inputs, imageName, query],
  )
  const chosen = inputs.filter((sourceId) => !left.has(sourceId))
  const shownChosen = shown.filter((sourceId) => !left.has(sourceId)).length

  function setChosen(sourceIds: ReadonlyArray<string>, value: boolean): void {
    setLeft((previous) => {
      const next = new Set(previous)
      for (const sourceId of sourceIds) {
        if (value) next.delete(sourceId)
        else next.add(sourceId)
      }
      return next
    })
  }

  function handleToggle(
    sourceId: string,
    value: boolean,
    range: boolean,
  ): void {
    const from =
      anchorRef.current === undefined ? -1 : shown.indexOf(anchorRef.current)
    const to = shown.indexOf(sourceId)
    anchorRef.current = sourceId
    if (!range || from === -1) {
      setChosen([sourceId], value)
      return
    }
    setChosen(shown.slice(Math.min(from, to), Math.max(from, to) + 1), value)
  }

  function handleSelectAll(value: boolean): void {
    setChosen(shown, value)
  }

  function handleQueryChange(event: React.ChangeEvent<HTMLInputElement>): void {
    setQuery(event.target.value)
  }

  function handleRun(): void {
    onRun(chosen)
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex min-h-0 flex-col gap-2"
    >
      <h3 id={headingId} className="text-title-sm">
        New run
      </h3>
      {inputs.length === 0 ? (
        <p className="text-caption text-muted-foreground">
          Add input images to the workflow first.
        </p>
      ) : (
        <>
          <Input
            type="search"
            aria-label="Search images"
            placeholder="Search images"
            value={query}
            onChange={handleQueryChange}
          />
          <div className="flex items-center justify-between gap-2">
            <SelectAll
              chosen={shownChosen}
              total={shown.length}
              onChange={handleSelectAll}
            />
            <span className="text-caption text-muted-foreground">
              {chosen.length} of {inputs.length} chosen
            </span>
          </div>
          <ul
            aria-label="Input images"
            className="flex min-h-0 flex-col overflow-y-auto"
          >
            {shown.map((sourceId) => (
              <PickerRow
                key={sourceId}
                sourceId={sourceId}
                name={imageName(sourceId)}
                chosen={!left.has(sourceId)}
                onToggle={handleToggle}
              />
            ))}
          </ul>
          {chosen.length === 0 && (
            <p className="text-caption text-muted-foreground">
              Choose at least one image.
            </p>
          )}
        </>
      )}
      <div className="flex justify-end gap-2">
        {onCancel !== undefined && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button size="sm" disabled={chosen.length === 0} onClick={handleRun}>
          <RiPlayLine aria-hidden="true" />
          Run on {imageCount(chosen.length)}
        </Button>
      </div>
    </section>
  )
}
