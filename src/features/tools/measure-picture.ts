import { followJob } from '@/features/jobs/follow-job'
import type { PictureSize } from '@/features/pipeline/canvas'
import { requestPreview } from '@/features/render/render-functions'
import { JobKind, JobState } from '@/server/jobs/job-types'

/**
 * The size, in its own pixels, of the picture a step added after `stepId`
 * acts on: what that step leaves, or the whole document when there is none.
 * Undefined when the picture could not be made.
 */
export async function pictureSizeAfter(
  documentId: string,
  stepId: string | undefined,
  signal: AbortSignal,
): Promise<PictureSize | undefined> {
  const queued = await requestPreview({
    data: {
      documentId,
      ...(stepId === undefined ? {} : { throughStepId: stepId }),
    },
  })
  const ended = await followJob(queued.id, signal)
  const result = ended?.result
  if (ended?.state !== JobState.Done || result?.kind !== JobKind.Preview) {
    return undefined
  }
  return { width: result.width, height: result.height }
}
