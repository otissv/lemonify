import { originalSourceId } from '@/features/pipeline/pipeline'
import type { SharpStep } from '@/features/pipeline/pipeline'
import { startingSharpOptions } from '@/features/workflows/sharp-starting-options'
import { documentSession, usePipelineStore } from '@/store/pipeline-store'

/** The document's own image, which a step that needs another image starts with. */
function documentImage(documentId: string): string | undefined {
  const session = documentSession(usePipelineStore.getState(), documentId)
  return session ? originalSourceId(session.confirmed.pipeline) : undefined
}

/** The options a Sharp step of this op starts with in this document, which a reset goes back to. */
export function documentStartingOptions(
  documentId: string,
  op: string,
): SharpStep['options'] {
  return startingSharpOptions(op, { imageId: documentImage(documentId) })
}
