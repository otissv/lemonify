import type { JobState } from '@/server/jobs/job-types'

export enum PreviewStatus {
  Rendering = 'rendering',
  Ready = 'ready',
  Failed = 'failed',
}

/** Why the server left a step out of the picture. */
export type StepProblem = { stepId: string; message: string }

import type { StepView } from '@/features/overlay/step-view'

export type { PictureSize } from '@/features/pipeline/canvas'
import type { PictureSize } from '@/features/pipeline/canvas'

/** A document's rendered pipeline; the last good picture stays while a new one is made or fails. */
export type DocumentPreview = {
  status: PreviewStatus
  /** The key of the picture, once one was made. */
  key?: string
  /** The picture's size in its own pixels, which the preview may have shrunk to be shown. */
  size?: PictureSize
  /** The step picture the canvas shows, or undefined when it is the whole document. Set with the picture. */
  view?: StepView
  /** Enabled AI steps with no result yet; the picture stops before the first. */
  pendingStepIds: ReadonlyArray<string>
  problems: ReadonlyArray<StepProblem>
  error?: string
}

/** Small pictures of each step; a step with a null key could not be shown yet. */
export type DocumentThumbnails = ReadonlyArray<{
  stepId: string
  key: string | null
  /** The picture is of what the step acts on, not of what it leaves. */
  before?: true
  /** The size of the picture in its own pixels; there with the key. */
  size?: PictureSize
}>

/** The AI step running for a document; the next pending ones follow it. */
export type AiRun = {
  jobId: string | null
  stepId: string
  state: JobState | 'starting'
  progress: number
  error?: string
}
