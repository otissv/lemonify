import { applyEdit } from '@/features/pipeline/pipeline-sync'
import { layerAsEmbeddedFn } from '@/features/workflows/create-from-functions'
import { errorMessage } from '@/lib/error-message'
import { usePipelineStore, workflowSession } from '@/store/pipeline-store'
import { useUiStore } from '@/store/ui-store'

const CONVERT_FAILED = 'The layer could not be converted.'

/**
 * Turns the document layer or workflow layer `stepId` of the open document or
 * workflow `itemId` into an embedded document layer holding a copy of what it
 * uses, as one edit that undo takes back. The server makes the copy; a refusal
 * is told to the person.
 */
export async function convertLayer(
  itemId: string,
  stepId: string,
): Promise<void> {
  const kind =
    workflowSession(usePipelineStore.getState(), itemId) === undefined
      ? 'document'
      : 'workflow'
  try {
    const step = await layerAsEmbeddedFn({
      data: { holder: { kind, id: itemId }, stepId },
    })
    await applyEdit(itemId, { type: 'convert-step', step })
  } catch (error) {
    useUiStore.getState().setLiveNotice(errorMessage(error, CONVERT_FAILED))
  }
}
