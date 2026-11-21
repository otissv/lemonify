import { catalogueFor, createAiStepFor } from '@/features/ai/ai-defaults'
import type { AiCatalogues } from '@/features/ai/ai-defaults'
import { createImageLayerStep } from '@/features/pipeline/layer-kinds'
import { createGroupStep, createSharpStep } from '@/features/pipeline/pipeline'
import type { PipelineStep } from '@/features/pipeline/pipeline'
import { NO_CATALOGUE } from '@/features/tools/add-tool'
import type { ToolChoice } from '@/features/tools/tool-catalogue'
import { startingSharpOptions } from '@/features/workflows/sharp-starting-options'
import { errorMessage } from '@/lib/error-message'

/** What a workflow can add: any tool a document has, an image layer, or a group. */
export type NewStepChoice =
  | ToolChoice
  | { kind: 'image-layer' }
  | { kind: 'group' }

/** The new step for a choice, or why it cannot be made. */
export function newWorkflowStep(
  choice: NewStepChoice,
  catalogues: AiCatalogues,
): { step: PipelineStep } | { problem: string } {
  switch (choice.kind) {
    case 'image-layer':
      return { step: createImageLayerStep() }
    case 'group':
      return { step: createGroupStep([]) }
    case 'sharp':
      return {
        step: createSharpStep(choice.value, startingSharpOptions(choice.value)),
      }
    case 'ai': {
      const catalogue = catalogueFor(catalogues, choice.value)
      if (catalogue === undefined) return { problem: NO_CATALOGUE }
      try {
        return { step: createAiStepFor(choice.value, catalogue) }
      } catch (caught) {
        return { problem: errorMessage(caught, NO_CATALOGUE) }
      }
    }
  }
}
