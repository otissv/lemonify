import { z } from 'zod'

import { PipelineSchema } from '@/features/pipeline/pipeline'
import { WorkflowDefinitionSchema } from '@/features/workflows/workflow'

/** The documents and workflows a run's layers use, as they were when it started, by id, at any depth. */
export const UsedSnapshotSchema = z.strictObject({
  documents: z.record(z.string(), PipelineSchema),
  workflows: z.record(z.string(), WorkflowDefinitionSchema),
})

export type UsedSnapshot = z.output<typeof UsedSnapshotSchema>

export const EMPTY_SNAPSHOT: UsedSnapshot = { documents: {}, workflows: {} }
