import { useEffect, useId, useRef, useState } from 'react'

import { Input } from '@/components/ui/input'
import { formatHex, parseHex } from '@/features/workflows/fields/colour-value'
import type { Rgba } from '@/features/workflows/fields/colour-value'
import { hsvToRgb, rgbToHsv } from '@/features/workflows/fields/colour-model'
import type { Hsv } from '@/features/workflows/fields/colour-model'

interface ColourPickerProps {
  colour: Rgba
  /** The colour the picker was opened on, shown beside the new one. */
  original: Rgba | undefined
  onChange: (colour: Rgba) => void
}

const BYTE_MAX = 255
const PERCENT = 100
const HUE_MAX = 360
const AREA_STEP = 0.01
const AREA_BIG_STEP = 0.1
const CHECKER =
  'repeating-conic-gradient(#808080 0% 25%, #c0c0c0 0% 50%) 50% / 12px 12px'
const RANGE_CLASSES =
  'h-3 w-full cursor-pointer appearance-none rounded-full border border-border [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-transparent [&::-webkit-slider-thumb]:shadow-[0_0_0_1px_rgba(0,0,0,0.6)] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none'

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function css({ r, g, b, alpha }: Rgba): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

interface NumberFieldProps {
  label: string
  value: number
  min: number
  max: number
  unit?: string
  onCommit: (value: number) => void
}

/** A whole-number field that takes what is typed once it is in range, and shows the real value when it changes elsewhere. */
function NumberField({
  label,
  value,
  min,
  max,
  unit,
  onCommit,
}: NumberFieldProps): React.JSX.Element {
  const id = useId()
  const [text, setText] = useState(String(value))

  useEffect(() => {
    setText((typed) =>
      typed.trim() !== '' && Number(typed) === value ? typed : String(value),
    )
  }, [value])

  function handleChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const next = event.target.value
    setText(next)
    const number = Number(next)
    if (
      next.trim() !== '' &&
      Number.isInteger(number) &&
      number >= min &&
      number <= max
    )
      onCommit(number)
  }

  function handleBlur(): void {
    setText(String(value))
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="w-4 text-caption text-muted-foreground">
        {label.at(0)}
      </label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        aria-label={label}
        className="h-8 px-2"
        value={text}
        onChange={handleChange}
        onBlur={handleBlur}
      />
      {unit && (
        <span className="w-3 text-caption text-muted-foreground">{unit}</span>
      )}
    </div>
  )
}

const FULL_HEX_LENGTHS = [6, 8]

function withHash(text: string): string {
  return text.startsWith('#') ? text : `#${text}`
}

/** A hex colour. Six or eight digits take effect as they are typed; three or four (shorthand) when the field is left. */
function HexField({
  colour,
  onChange,
}: {
  colour: Rgba
  onChange: (colour: Rgba) => void
}): React.JSX.Element {
  const id = useId()
  const hex = formatHex(colour)
  const [text, setText] = useState(hex.slice(1))

  useEffect(() => {
    setText((typed) => {
      const parsed = parseHex(withHash(typed))
      return parsed && formatHex(parsed) === hex ? typed : hex.slice(1)
    })
  }, [hex])

  function handleChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const next = event.target.value.replace(/^#/, '')
    setText(next)
    if (!FULL_HEX_LENGTHS.includes(next.length)) return
    const parsed = parseHex(withHash(next))
    if (parsed) onChange(parsed)
  }

  function handleBlur(): void {
    const parsed = parseHex(withHash(text))
    if (parsed) onChange(parsed)
    setText((parsed ? formatHex(parsed) : hex).slice(1))
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="w-4 text-caption text-muted-foreground">
        #
      </label>
      <Input
        id={id}
        aria-label="Hex"
        spellCheck={false}
        maxLength={8}
        className="h-8 px-2 font-mono"
        value={text}
        onChange={handleChange}
        onBlur={handleBlur}
      />
    </div>
  )
}

interface AreaProps {
  hsv: Hsv
  onChange: (saturation: number, brightness: number) => void
}

/** Saturation across, brightness up: drag, or use the arrow keys (Shift for bigger steps). */
function SaturationArea({ hsv, onChange }: AreaProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  function pick(event: React.PointerEvent<HTMLDivElement>): void {
    const box = ref.current?.getBoundingClientRect()
    if (!box || box.width === 0 || box.height === 0) return
    onChange(
      clamp((event.clientX - box.left) / box.width, 0, 1),
      1 - clamp((event.clientY - box.top) / box.height, 0, 1),
    )
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    event.currentTarget.setPointerCapture(event.pointerId)
    pick(event)
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) pick(event)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const step = event.shiftKey ? AREA_BIG_STEP : AREA_STEP
    const moves: Record<string, [number, number] | undefined> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    onChange(clamp(hsv.s + move[0], 0, 1), clamp(hsv.v + move[1], 0, 1))
  }

  const pure = `hsl(${hsv.h}, 100%, 50%)`
  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label="Saturation and brightness"
      aria-roledescription="2D slider"
      aria-valuemin={0}
      aria-valuemax={PERCENT}
      aria-valuenow={Math.round(hsv.s * PERCENT)}
      aria-valuetext={`Saturation ${Math.round(hsv.s * PERCENT)}%, brightness ${Math.round(hsv.v * PERCENT)}%`}
      className="relative h-40 w-full cursor-crosshair touch-none rounded-md border border-border focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      style={{
        backgroundColor: pure,
        backgroundImage:
          'linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, rgba(255,255,255,0))',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onKeyDown={handleKeyDown}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
        style={{
          left: `${hsv.s * PERCENT}%`,
          top: `${(1 - hsv.v) * PERCENT}%`,
        }}
      />
    </div>
  )
}

function Preview({
  label,
  colour,
}: {
  label: string
  colour: Rgba | undefined
}): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center gap-1">
      <span className="text-caption text-muted-foreground">{label}</span>
      <span
        role="img"
        aria-label={`${label} colour`}
        className="h-10 w-full rounded-md border border-border"
        style={{
          background: colour
            ? `linear-gradient(${css(colour)}, ${css(colour)}), ${CHECKER}`
            : CHECKER,
        }}
      />
    </div>
  )
}

/**
 * A colour picker in the manner of a graphics editor: a saturation and
 * brightness area, hue and opacity sliders, the new colour beside the
 * current one, and hex, RGB and HSB fields.
 */
export function ColourPicker({
  colour,
  original,
  onChange,
}: ColourPickerProps): React.JSX.Element {
  const [hsv, setHsv] = useState<Hsv>(() => rgbToHsv(colour))

  useEffect(() => {
    setHsv((own) => {
      const same = hsvToRgb(own)
      if (same.r === colour.r && same.g === colour.g && same.b === colour.b)
        return own
      const next = rgbToHsv(colour)
      return {
        h: next.s === 0 || next.v === 0 ? own.h : next.h,
        s: next.s,
        v: next.v,
      }
    })
  }, [colour])

  function emit(next: Hsv, alpha = colour.alpha): void {
    setHsv(next)
    onChange({ ...hsvToRgb(next), alpha })
  }

  function handleChannel(channel: 'r' | 'g' | 'b', value: number): void {
    const next = { ...colour, [channel]: value }
    setHsv((own) => {
      const found = rgbToHsv(next)
      return {
        h: found.s === 0 || found.v === 0 ? own.h : found.h,
        s: found.s,
        v: found.v,
      }
    })
    onChange(next)
  }

  function handleHue(event: React.ChangeEvent<HTMLInputElement>): void {
    emit({ ...hsv, h: Number(event.target.value) })
  }

  function handleAlpha(event: React.ChangeEvent<HTMLInputElement>): void {
    onChange({ ...colour, alpha: Number(event.target.value) / PERCENT })
  }

  return (
    <div className="flex flex-col gap-3">
      <SaturationArea
        hsv={hsv}
        onChange={(s, v) => {
          emit({ ...hsv, s, v })
        }}
      />
      <input
        type="range"
        aria-label="Hue"
        min={0}
        max={HUE_MAX}
        step={1}
        value={Math.round(hsv.h)}
        className={RANGE_CLASSES}
        style={{
          background:
            'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
        }}
        onChange={handleHue}
      />
      <input
        type="range"
        aria-label="Opacity"
        min={0}
        max={PERCENT}
        step={1}
        value={Math.round(colour.alpha * PERCENT)}
        className={RANGE_CLASSES}
        style={{
          background: `linear-gradient(to right, rgba(${colour.r},${colour.g},${colour.b},0), rgb(${colour.r},${colour.g},${colour.b})), ${CHECKER}`,
        }}
        onChange={handleAlpha}
      />
      <div className="flex gap-3">
        <Preview label="New" colour={colour} />
        <Preview label="Current" colour={original} />
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <HexField colour={colour} onChange={onChange} />
        <NumberField
          label="Opacity"
          value={Math.round(colour.alpha * PERCENT)}
          min={0}
          max={PERCENT}
          unit="%"
          onCommit={(value) => {
            onChange({ ...colour, alpha: value / PERCENT })
          }}
        />
        <NumberField
          label="Red"
          value={colour.r}
          min={0}
          max={BYTE_MAX}
          onCommit={(v) => {
            handleChannel('r', v)
          }}
        />
        <NumberField
          label="Hue"
          value={Math.round(hsv.h)}
          min={0}
          max={HUE_MAX}
          unit="°"
          onCommit={(h) => {
            emit({ ...hsv, h })
          }}
        />
        <NumberField
          label="Green"
          value={colour.g}
          min={0}
          max={BYTE_MAX}
          onCommit={(v) => {
            handleChannel('g', v)
          }}
        />
        <NumberField
          label="Saturation"
          value={Math.round(hsv.s * PERCENT)}
          min={0}
          max={PERCENT}
          unit="%"
          onCommit={(s) => {
            emit({ ...hsv, s: s / PERCENT })
          }}
        />
        <NumberField
          label="Blue"
          value={colour.b}
          min={0}
          max={BYTE_MAX}
          onCommit={(v) => {
            handleChannel('b', v)
          }}
        />
        <NumberField
          label="Brightness"
          value={Math.round(hsv.v * PERCENT)}
          min={0}
          max={PERCENT}
          unit="%"
          onCommit={(v) => {
            emit({ ...hsv, v: v / PERCENT })
          }}
        />
      </div>
    </div>
  )
}
