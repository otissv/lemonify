import { PreviewStatus } from '@/features/documents/document-render'
import { viewedStepId } from '@/features/overlay/viewed-step'
import { followJob } from '@/features/jobs/follow-job'
import { cancelJob } from '@/features/jobs/job-functions'
import {
  requestAiStep,
  requestPreview,
  requestThumbnails,
} from '@/features/render/render-functions'
import { errorMessage } from '@/lib/error-message'
import { JobKind, JobState } from '@/server/jobs/job-types'
import { useLibraryStore } from '@/store/library-store'
import { documentSession, usePipelineStore } from '@/store/pipeline-store'
import { useUiStore } from '@/store/ui-store'

const PREVIEW_FAILED = 'The picture could not be made.'
const AI_FAILED = 'The AI step could not be run.'

const aiControllers = new Map<string, AbortController>()

/** The step the canvas shows the picture before, for the document as it is saved and the step selected now. */
function viewedStep(documentId: string): string | undefined {
  const session = documentSession(usePipelineStore.getState(), documentId)
  if (!session) return undefined
  return viewedStepId(
    useUiStore.getState().selectedSteps[documentId],
    session.confirmed.pipeline,
  )
}

/**
 * Asks the server for the picture the canvas shows and follows the Job: the
 * document as it is now, or the picture before the selected step when a tool
 * draws on it. The last good picture stays on screen while the new one is
 * made. A Job a newer request replaced ends cancelled and is ignored.
 */
export async function refreshPreview(
  documentId: string,
  signal: AbortSignal,
): Promise<void> {
  const store = usePipelineStore.getState()
  const before = store.previews[documentId]
  const beforeStepId = viewedStep(documentId)
  store.setPreview(documentId, {
    ...before,
    pendingStepIds: before?.pendingStepIds ?? [],
    problems: before?.problems ?? [],
    status: PreviewStatus.Rendering,
    error: undefined,
  })
  try {
    const queued = await requestPreview({ data: { documentId, beforeStepId } })
    const ended = await followJob(queued.id, signal)
    if (ended === undefined || ended.state === JobState.Cancelled) return
    const { result } = ended
    if (ended.state === JobState.Done && result?.kind === JobKind.Preview) {
      usePipelineStore.getState().setPreview(documentId, {
        status: PreviewStatus.Ready,
        key: result.key,
        size: { width: result.width, height: result.height },
        beforeStepId,
        pendingStepIds: result.pendingStepIds,
        problems: result.problems,
      })
      return
    }
    failPreview(documentId, ended.error ?? PREVIEW_FAILED)
  } catch (error) {
    if (!signal.aborted)
      failPreview(documentId, errorMessage(error, PREVIEW_FAILED))
  }
}

function failPreview(documentId: string, error: string): void {
  const store = usePipelineStore.getState()
  const before = store.previews[documentId]
  store.setPreview(documentId, {
    ...before,
    pendingStepIds: before?.pendingStepIds ?? [],
    problems: before?.problems ?? [],
    status: PreviewStatus.Failed,
    error,
  })
}

/** Asks for small pictures of every step; a step whose picture cannot be made is simply left without one. */
export async function refreshThumbnails(
  documentId: string,
  signal: AbortSignal,
): Promise<void> {
  try {
    const queued = await requestThumbnails({ data: { documentId } })
    const ended = await followJob(queued.id, signal)
    const result = ended?.result
    if (ended?.state !== JobState.Done || result?.kind !== JobKind.Thumbnail) {
      return
    }
    usePipelineStore.getState().setThumbnails(documentId, result.thumbnails)
  } catch {
    if (signal.aborted) return
  }
}

/**
 * Runs the document's pending AI steps one after another, each after the
 * picture has been renewed so the next one is known. Runs on until done,
 * failed or cancelled, whatever page is showing.
 */
export async function runPendingAiSteps(documentId: string): Promise<void> {
  if (aiControllers.has(documentId)) return
  const controller = new AbortController()
  aiControllers.set(documentId, controller)
  try {
    for (;;) {
      const stepId =
        usePipelineStore.getState().previews[documentId]?.pendingStepIds[0]
      if (stepId === undefined) return
      const stopped = await runOneAiStep(documentId, stepId, controller.signal)
      if (stopped) return
      await refreshPreview(documentId, controller.signal)
    }
  } finally {
    aiControllers.delete(documentId)
  }
}

/** Runs one step; true when the run should not go on. */
async function runOneAiStep(
  documentId: string,
  stepId: string,
  signal: AbortSignal,
): Promise<boolean> {
  const store = usePipelineStore.getState()
  store.setAiRun(documentId, {
    jobId: null,
    stepId,
    state: 'starting',
    progress: 0,
  })
  try {
    const queued = await requestAiStep({ data: { documentId, stepId } })
    const ended = await followJob(queued.id, signal, (job) => {
      usePipelineStore.getState().setAiRun(documentId, {
        jobId: job.id,
        stepId,
        state: job.state,
        progress: job.progress,
      })
    })
    if (ended?.state === JobState.Done) {
      usePipelineStore.getState().setAiRun(documentId, undefined)
      void useLibraryStore.getState().refreshResults()
      return false
    }
    if (ended?.state === JobState.Failed) {
      failRun(documentId, stepId, ended.error ?? AI_FAILED)
      return true
    }
    usePipelineStore.getState().setAiRun(documentId, undefined)
    return true
  } catch (error) {
    failRun(documentId, stepId, errorMessage(error, AI_FAILED))
    return true
  }
}

function failRun(documentId: string, stepId: string, error: string): void {
  usePipelineStore.getState().setAiRun(documentId, {
    jobId: null,
    stepId,
    state: JobState.Failed,
    progress: 0,
    error,
  })
}

/** Asks the running AI step to stop; the run ends when the server says it has. */
export async function cancelAiRun(documentId: string): Promise<void> {
  const jobId = usePipelineStore.getState().aiRuns[documentId]?.jobId
  if (jobId === null || jobId === undefined) return
  try {
    await cancelJob({ data: { id: jobId } })
  } catch (error) {
    const run = usePipelineStore.getState().aiRuns[documentId]
    if (run) {
      usePipelineStore.getState().setAiRun(documentId, {
        ...run,
        error: errorMessage(error, 'The AI step could not be cancelled.'),
      })
    }
  }
}
