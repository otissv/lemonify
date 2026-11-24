import { catalogueFor, createAiStepFor } from '@/features/ai/ai-defaults'
import type { AiCatalogues } from '@/features/ai/ai-defaults'
import type { PictureSize } from '@/features/pipeline/canvas'
import { createSharpStep } from '@/features/pipeline/pipeline'
import { addStepAfter } from '@/features/pipeline/pipeline-actions'
import { startsAtPictureSize } from '@/features/pipeline/sharp-starting-options'
import { documentStartingOptions } from '@/features/tools/document-starting-options'
import { pictureSizeAfter } from '@/features/tools/measure-picture'
import type { ToolChoice } from '@/features/tools/tool-catalogue'
import { errorMessage } from '@/lib/error-message'
import { useUiStore } from '@/store/ui-store'

export const NO_CATALOGUE = 'That AI tool is not available right now.'
export const NOT_MEASURED =
  'The picture could not be measured, so the new step has no size yet.'

/** How long a new step waits for its picture to be measured before it is added without a size. */
const MEASURE_TIMEOUT_MS = 30_000

async function measured(
  documentId: string,
  afterId: string | undefined,
): Promise<PictureSize | undefined> {
  try {
    const signal = AbortSignal.timeout(MEASURE_TIMEOUT_MS)
    return await pictureSizeAfter(documentId, afterId, signal)
  } catch {
    return undefined
  }
}

/** Adds a step that starts at the size of the picture it acts on once that picture is measured, so it changes nothing until edited. */
async function addSizedSharpStep(
  documentId: string,
  op: string,
  afterId: string | undefined,
): Promise<void> {
  const size = await measured(documentId, afterId)
  if (size === undefined) useUiStore.getState().setLiveNotice(NOT_MEASURED)
  const options = documentStartingOptions(documentId, op, size)
  addStepAfter(documentId, createSharpStep(op, options), afterId)
}

/** Adds a tool to the document as a step after the selected one, as the tool browser does. Returns why it could not be added, or nothing when it was or will be. */
export function addTool(
  documentId: string,
  tool: ToolChoice,
  catalogues: AiCatalogues,
): string | undefined {
  const afterId = useUiStore.getState().selectedSteps[documentId]
  if (tool.kind === 'sharp') {
    if (startsAtPictureSize(tool.value)) {
      void addSizedSharpStep(documentId, tool.value, afterId)
      return undefined
    }
    const options = documentStartingOptions(documentId, tool.value)
    addStepAfter(documentId, createSharpStep(tool.value, options), afterId)
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
