import { catalogueFor, createAiStepFor } from '@/features/ai/ai-defaults'
import type { AiCatalogues } from '@/features/ai/ai-defaults'
import { createSharpStep } from '@/features/pipeline/pipeline'
import { addStepAfter } from '@/features/pipeline/pipeline-actions'
import type { ToolChoice } from '@/features/tools/tool-catalogue'
import { errorMessage } from '@/lib/error-message'
import { documentStartingOptions } from '@/features/tools/document-starting-options'
import { useUiStore } from '@/store/ui-store'

export const NO_CATALOGUE = 'That AI tool is not available right now.'

/** Adds a tool to the document as a step after the selected one, as the tool browser does. Returns why it could not be added, or nothing when it was. */
export function addTool(
  documentId: string,
  tool: ToolChoice,
  catalogues: AiCatalogues,
): string | undefined {
  const afterId = useUiStore.getState().selectedSteps[documentId]
  if (tool.kind === 'sharp') {
    addStepAfter(
      documentId,
      createSharpStep(
        tool.value,
        documentStartingOptions(documentId, tool.value),
      ),
      afterId,
    )
    return undefined
  }
  const catalogue = catalogueFor(catalogues, tool.value)
  if (catalogue === undefined) return NO_CATALOGUE
  try {
    addStepAfter(documentId, createAiStepFor(tool.value, catalogue), afterId)
  } catch (caught) {
    return errorMessage(caught, NO_CATALOGUE)
  }
  return undefined
}
