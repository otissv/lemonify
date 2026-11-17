import { z } from 'zod'

import { AiToolId } from '@/features/ai/ai-tools'
import type { WorkerPool } from '@/features/ai/ai-tools'
import { ExportSettingsSchema } from '@/features/export/export-settings'
import { RunCanvasModeSchema } from '@/features/workflows/workflow'

export enum JobKind {
  Preview = 'preview',
  Thumbnail = 'thumbnail',
  WorkflowThumbnail = 'workflow-thumbnail',
  AiStep = 'ai-step',
  Export = 'export',
  RunItem = 'run-item',
}

export enum JobState {
  Waiting = 'waiting',
  Running = 'running',
  Done = 'done',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

export const TERMINAL_STATES: ReadonlyArray<JobState> = [
  JobState.Done,
  JobState.Failed,
  JobState.Cancelled,
]

/** Lower runs first. A person waiting on a preview is served before background work. */
export const JOB_PRIORITY: Readonly<Record<JobKind, number>> = {
  [JobKind.Preview]: 0,
  [JobKind.Thumbnail]: 1,
  [JobKind.WorkflowThumbnail]: 1,
  [JobKind.Export]: 2,
  [JobKind.AiStep]: 2,
  [JobKind.RunItem]: 3,
}

const id = z.string().min(1)
const revision = z.number().int().nonnegative()

/** What a Job is asked to do. A `revision` pins it to one state of its Document. */
export const JobPayloadSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal(JobKind.Preview),
    documentId: id,
    revision,
  }),
  z.strictObject({
    kind: z.literal(JobKind.Thumbnail),
    documentId: id,
    revision,
    stepIds: z.array(id),
  }),
  z.strictObject({
    kind: z.literal(JobKind.WorkflowThumbnail),
    workflowId: id,
    revision,
    canvasMode: RunCanvasModeSchema,
    nodeIds: z.array(id),
  }),
  z.strictObject({
    kind: z.literal(JobKind.AiStep),
    documentId: id,
    revision,
    stepId: id,
    tool: z.enum(AiToolId),
    batchKey: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal(JobKind.Export),
    documentId: id,
    revision,
    settings: ExportSettingsSchema,
    width: z.number().int().positive().optional(),
  }),
  z.strictObject({
    kind: z.literal(JobKind.RunItem),
    workflowRunId: id,
    sourceId: id,
    segment: z.number().int().nonnegative(),
    /** Set on an AI segment so the GPU worker can batch images that share a model. */
    batchKey: z.string().min(1).optional(),
    /** The AI tool of an AI segment, so its batch can be capped by that tool. */
    tool: z.enum(AiToolId).optional(),
    /** The work image the previous segment left for this one; absent on the first. */
    input: z.string().min(1).optional(),
  }),
])

export type JobPayload = z.output<typeof JobPayloadSchema>

const ProblemSchema = z.strictObject({
  stepId: id,
  message: z.string(),
})

/** What a finished Job made: a Render key for a preview or thumbnail, a Result id for the rest. */
export const JobResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal(JobKind.Preview),
    key: z.string().min(1),
    /** Enabled AI Steps still waiting for a Result, so the preview shows the Pipeline only up to them. */
    pendingStepIds: z.array(id),
    problems: z.array(ProblemSchema),
  }),
  z.strictObject({
    kind: z.literal(JobKind.Thumbnail),
    thumbnails: z.array(
      z.strictObject({ stepId: id, key: z.string().min(1).nullable() }),
    ),
  }),
  z.strictObject({
    kind: z.literal(JobKind.WorkflowThumbnail),
    thumbnails: z.array(
      z.strictObject({ stepId: id, key: z.string().min(1).nullable() }),
    ),
  }),
  z.strictObject({ kind: z.literal(JobKind.AiStep), resultId: id }),
  z.strictObject({ kind: z.literal(JobKind.Export), resultId: id }),
  z.strictObject({
    kind: z.literal(JobKind.RunItem),
    resultIds: z.array(id),
  }),
])

export type JobResult = z.output<typeof JobResultSchema>

export type JobRecord = {
  id: string
  kind: JobKind
  ownerId: string
  pool: WorkerPool
  priority: number
  /** What fairness shares between: the Document id or the workflow run id. */
  groupKey: string
  documentId: string | null
  workflowRunId: string | null
  state: JobState
  /** 0 to 1. */
  progress: number
  payload: JobPayload
  result: JobResult | null
  error: string | null
  /** The process running it, as `pid:startedAt`; null until claimed. */
  claimedBy: string | null
  cancelRequested: boolean
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export type JobOutcome =
  | { state: JobState.Done; result: JobResult }
  | { state: JobState.Failed; error: string }
  | { state: JobState.Cancelled }

export function isTerminal(state: JobState): boolean {
  return TERMINAL_STATES.includes(state)
}

/** Which Jobs may share a GPU batch: those with the same key. Jobs without one run alone. */
export function batchKeyOf(job: JobRecord): string | undefined {
  const { payload } = job
  if (payload.kind === JobKind.AiStep) return payload.batchKey
  if (payload.kind === JobKind.RunItem) return payload.batchKey
  return undefined
}
