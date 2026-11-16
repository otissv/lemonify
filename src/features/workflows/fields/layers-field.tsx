import { RiDeleteBinLine } from '@remixicon/react'
import { useId } from 'react'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type {
  ControlProps,
  JsonValue,
} from '@/features/workflows/fields/control-props'
import { ImagePicker } from '@/features/workflows/fields/image-picker'
import { useImageNames } from '@/features/workflows/fields/image-choices'
import { BLEND_MODES } from '@/lib/images/sharp/input-options'

const DEFAULT_CHOICE = '__default__'

const LayerSchema = z.looseObject({ input: z.unknown() })
const LayersSchema = z.array(LayerSchema)

type Layer = z.infer<typeof LayerSchema>

interface LayerEditorProps {
  layer: Layer
  position: number
  onChange: (position: number, layer: Layer) => void
  onRemove: (position: number) => void
}

function layerNumber(layer: Layer, key: 'top' | 'left'): string {
  const value = layer[key]
  return typeof value === 'number' ? String(value) : ''
}

function withoutKey(layer: Layer, key: string): Layer {
  return Object.fromEntries(
    Object.entries(layer).filter(([name]) => name !== key),
  ) as Layer
}

function LayerEditor({
  layer,
  position,
  onChange,
  onRemove,
}: LayerEditorProps): React.JSX.Element {
  const id = useId()
  const nameOf = useImageNames()
  const input = typeof layer.input === 'string' ? layer.input : undefined
  const title = input ? nameOf(input) : 'Generated image'
  const number = (key: 'top' | 'left') =>
    function handleNumber(event: React.ChangeEvent<HTMLInputElement>): void {
      const text = event.target.value
      if (text === '') onChange(position, withoutKey(layer, key))
      else if (Number.isInteger(Number(text)))
        onChange(position, { ...layer, [key]: Number(text) })
    }

  function handleBlend(value: string): void {
    onChange(
      position,
      value === DEFAULT_CHOICE
        ? withoutKey(layer, 'blend')
        : { ...layer, blend: value },
    )
  }

  function handleTile(tile: boolean): void {
    onChange(position, { ...layer, tile })
  }

  function handleRemove(): void {
    onRemove(position)
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border border-border p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-body-md">{title}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Remove layer ${position + 1}`}
          onClick={handleRemove}
        >
          <RiDeleteBinLine aria-hidden="true" />
        </Button>
      </div>
      {input === undefined ? (
        <p className="text-caption text-muted-foreground">
          This layer is a generated image and is kept as it is.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${id}-top`}>Top</Label>
              <Input
                id={`${id}-top`}
                type="number"
                step={1}
                value={layerNumber(layer, 'top')}
                onChange={number('top')}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${id}-left`}>Left</Label>
              <Input
                id={`${id}-left`}
                type="number"
                step={1}
                value={layerNumber(layer, 'left')}
                onChange={number('left')}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label id={`${id}-blend`}>Blend</Label>
            <Select
              value={
                typeof layer.blend === 'string' ? layer.blend : DEFAULT_CHOICE
              }
              onValueChange={handleBlend}
            >
              <SelectTrigger aria-labelledby={`${id}-blend`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_CHOICE}>Default</SelectItem>
                {BLEND_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {mode}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={`${id}-tile`}>Tile</Label>
            <Switch
              id={`${id}-tile`}
              checked={layer.tile === true}
              onCheckedChange={handleTile}
            />
          </div>
        </>
      )}
    </li>
  )
}

/** The layers of a composite step: images laid over the picture, each with a place and a blend mode. */
export function LayersControl({
  field,
  value,
  onChange,
}: ControlProps): React.JSX.Element {
  const parsed = LayersSchema.safeParse(value)
  const layers = parsed.success ? parsed.data : []

  function emit(next: Array<Layer>): void {
    onChange(field.name, next.length === 0 ? undefined : (next as JsonValue))
  }

  function handleAdd(sourceId: string): void {
    emit([...layers, { input: sourceId }])
  }

  function handleLayer(position: number, layer: Layer): void {
    emit(
      layers.map((existing, index) => (index === position ? layer : existing)),
    )
  }

  function handleRemove(position: number): void {
    emit(layers.filter((_layer, index) => index !== position))
  }

  return (
    <div className="flex flex-col gap-2">
      {layers.length === 0 ? (
        <p className="text-caption text-muted-foreground">No layers yet.</p>
      ) : (
        <ul aria-label={field.label} className="flex flex-col gap-2">
          {layers.map((layer, position) => (
            <LayerEditor
              // biome-ignore lint/suspicious/noArrayIndexKey: layers have no id; their position is their identity
              key={position}
              layer={layer}
              position={position}
              onChange={handleLayer}
              onRemove={handleRemove}
            />
          ))}
        </ul>
      )}
      <ImagePicker label="layer" onPick={handleAdd} />
    </div>
  )
}
