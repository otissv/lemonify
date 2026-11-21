import { catalogueFor, createAiStepFor } from '@/features/ai/ai-defaults'
import type { AiCatalogues } from '@/features/ai/ai-defaults'
import { createSharpStep, originalSourceId } from '@/features/pipeline/pipeline'
import { addStepAfter } from '@/features/pipeline/pipeline-actions'
import type { ToolChoice } from '@/features/tools/tool-catalogue'
import { errorMessage } from '@/lib/error-message'
import { startingSharpOptions } from '@/features/workflows/sharp-starting-options'
import { documentSession, usePipelineStore } from '@/store/pipeline-store'
import { useUiStore } from '@/store/ui-store'

export const NO_CATALOGUE = 'That AI tool is not available right now.'

/** The document's own image, which a step that needs another image starts with. */
function documentImage(documentId: string): string | undefined {
  const session = documentSession(usePipelineStore.getState(), documentId)
  return session ? originalSourceId(session.confirmed.pipeline) : undefined
}

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
        startingSharpOptions(tool.value, {
          imageId: documentImage(documentId),
        }),
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
