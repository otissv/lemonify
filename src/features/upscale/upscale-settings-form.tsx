import { useId } from 'react'

import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  MAX_UPSCALE_PASSES,
  MIN_UPSCALE_PASSES,
  withModel,
} from '@/features/upscale/upscale-settings'
import type {
  UpscaleCatalogue,
  UpscaleModelSummary,
  UpscaleSettings,
} from '@/features/upscale/upscale-settings'
import { useAppStore } from '@/store/app-store'

interface UpscaleSettingsFormProps {
  catalogue: UpscaleCatalogue
  settings: UpscaleSettings
  onChange: (settings: UpscaleSettings) => void
}

const CATEGORY_LABELS: Readonly<
  Record<UpscaleModelSummary['category'], string>
> = {
  upscale: 'Upscale',
  descreen: 'Descreen',
  'artifact-removal': 'Artifact removal',
}

function modelsByCategory(
  models: ReadonlyArray<UpscaleModelSummary>,
): Map<UpscaleModelSummary['category'], Array<UpscaleModelSummary>> {
  const groups = new Map<
    UpscaleModelSummary['category'],
    Array<UpscaleModelSummary>
  >()
  for (const model of models) {
    const group = groups.get(model.category) ?? []
    group.push(model)
    groups.set(model.category, group)
  }
  return groups
}

const RECENT_PREFIX = 'recent:'

function recentModels(
  names: ReadonlyArray<string>,
  catalogue: UpscaleCatalogue,
): Array<UpscaleModelSummary> {
  const models: Array<UpscaleModelSummary> = []
  for (const name of names) {
    const model = catalogue.models.find((candidate) => candidate.name === name)
    if (model) models.push(model)
  }
  return models
}

function noiseLabel(level: number): string {
  return level < 0 ? 'None' : String(level)
}

export function UpscaleSettingsForm({
  catalogue,
  settings,
  onChange: save,
}: UpscaleSettingsFormProps): React.JSX.Element {
  const ids = {
    model: useId(),
    scale: useId(),
    noise: useId(),
    passes: useId(),
    tta: useId(),
  }
  const recentNames = useAppStore((state) => state.recentUpscaleModels)
  const rememberUpscaleModel = useAppStore(
    (state) => state.rememberUpscaleModel,
  )
  const model = catalogue.models.find(({ name }) => name === settings.model)
  const groups = modelsByCategory(catalogue.models)
  const recent = recentModels(recentNames, catalogue)

  function handleModelChange(value: string): void {
    const name = value.startsWith(RECENT_PREFIX)
      ? value.slice(RECENT_PREFIX.length)
      : value
    rememberUpscaleModel(name)
    save(withModel(settings, catalogue, name))
  }

  function handleScaleChange(value: string): void {
    save({ ...settings, scale: Number(value) })
  }

  function handleNoiseChange(value: string): void {
    save({ ...settings, noise: Number(value) })
  }

  function handlePassesChange(values: Array<number>): void {
    const passes = values.at(0)
    if (passes === undefined) return
    save({ ...settings, iterations: passes })
  }

  function handleTtaChange(tta: boolean): void {
    save({ ...settings, tta })
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-2">
        <Label id={ids.model}>Model</Label>
        <Select value={settings.model} onValueChange={handleModelChange}>
          <SelectTrigger aria-labelledby={ids.model} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {recent.length > 0 && (
              <SelectGroup>
                <SelectLabel>Recent</SelectLabel>
                {recent.map(({ name, description }) => (
                  <SelectItem key={name} value={`${RECENT_PREFIX}${name}`}>
                    {description}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
            {[...groups].map(([category, models]) => (
              <SelectGroup key={category}>
                <SelectLabel>{CATEGORY_LABELS[category]}</SelectLabel>
                {models.map(({ name, description }) => (
                  <SelectItem key={name} value={name}>
                    {description}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label id={ids.scale}>Scale</Label>
        <Select
          value={String(settings.scale)}
          onValueChange={handleScaleChange}
        >
          <SelectTrigger aria-labelledby={ids.scale} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {model?.scales.map((scale) => (
              <SelectItem key={scale} value={String(scale)}>
                {scale}×
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {model?.noise && settings.noise !== undefined && (
        <div className="flex flex-col gap-2">
          <Label id={ids.noise}>Noise reduction</Label>
          <Select
            value={String(settings.noise)}
            onValueChange={handleNoiseChange}
          >
            <SelectTrigger aria-labelledby={ids.noise} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {model.noise.map((level) => (
                <SelectItem key={level} value={String(level)}>
                  {noiseLabel(level)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label id={ids.passes}>Passes</Label>
          <span className="text-body-md text-muted-foreground">
            {settings.iterations}
          </span>
        </div>
        <Slider
          thumbLabel="Passes"
          aria-describedby={ids.passes}
          min={MIN_UPSCALE_PASSES}
          max={MAX_UPSCALE_PASSES}
          step={1}
          value={[settings.iterations]}
          onValueChange={handlePassesChange}
        />
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor={ids.tta}>Test-time augmentation</Label>
          <p className="text-caption text-muted-foreground">
            Slightly sharper, about 8× slower.
          </p>
        </div>
        <Switch
          id={ids.tta}
          checked={settings.tta}
          onCheckedChange={handleTtaChange}
        />
      </div>
    </div>
  )
}
