import { AiToolId } from '@/features/ai/ai-tools'
import type { AiCatalogue } from '@/features/ai/ai-tools'
import { createAiStep } from '@/features/pipeline/pipeline'
import type { AiStep } from '@/features/pipeline/pipeline'
import { defaultUpscaleSettings } from '@/features/upscale/upscale-settings'

/** A new step for an AI tool, with the settings that tool's catalogue starts from. */
export function createAiStepFor(
  tool: AiToolId,
  catalogue: AiCatalogue,
): AiStep {
  switch (tool) {
    case AiToolId.Upscale:
      return createAiStep({
        tool,
        settings: defaultUpscaleSettings(catalogue),
      })
  }
}

/** A short line about an AI step's settings, shown under its name. */
export function aiStepSummary(step: AiStep): string {
  switch (step.tool) {
    case AiToolId.Upscale:
      return `${step.settings.model} · ${step.settings.scale}×`
  }
}

/** The catalogue the server gave for each AI tool it offers. */
export type AiCatalogues = ReadonlyArray<{
  tool: AiToolId
  catalogue: AiCatalogue
}>

export function catalogueFor(
  catalogues: AiCatalogues,
  tool: AiToolId,
): AiCatalogue | undefined {
  return catalogues.find((entry) => entry.tool === tool)?.catalogue
}
