import { z } from 'zod'

import {
  DocumentChangeSchema,
  InvalidChangeError,
  planChange,
} from '@/features/pipeline/document-change'
import { OutputSettingsSchema } from '@/features/workflows/output-settings'
import { WorkflowDefinitionSchema } from '@/features/workflows/workflow'
import type { WorkflowDefinition } from '@/features/workflows/workflow'

/**
 * One edit of a workflow: any change a document takes (its pipeline is the
 * same), and the three that are about the workflow itself. Each is one Edit
 * history entry, and the client and the server apply it the same way.
 */
export const WorkflowChangeSchema = z.discriminatedUnion('type', [
  ...DocumentChangeSchema.options,
  z.strictObject({
    type: z.literal('set-inputs'),
    /** The whole list of images the workflow runs on, so an undo puts it back exactly. */
    sourceIds: z.array(z.string().min(1)),
  }),
  z.strictObject({
    type: z.literal('set-output'),
    output: OutputSettingsSchema,
  }),
  /** Replaces everything, for a workflow written whole (the CLI's `workflow update`). */
  z.strictObject({
    type: z.literal('replace'),
    definition: WorkflowDefinitionSchema,
  }),
])

export type WorkflowChange = z.output<typeof WorkflowChangeSchema>

/** A change and the change that undoes it; the pair is what one Edit history entry stores. */
export const WorkflowHistoryPatchSchema = z.strictObject({
  forward: WorkflowChangeSchema,
  inverse: WorkflowChangeSchema,
})

export type WorkflowHistoryPatch = z.output<typeof WorkflowHistoryPatchSchema>

function checked(candidate: unknown): WorkflowDefinition {
  const parsed = WorkflowDefinitionSchema.safeParse(candidate)
  if (!parsed.success) {
    throw new InvalidChangeError(
      parsed.error.issues[0]?.message ?? 'That change is not valid.',
    )
  }
  return parsed.data
}

function planned(
  definition: WorkflowDefinition,
  change: WorkflowChange,
): { definition: WorkflowDefinition; patch: WorkflowHistoryPatch } {
  switch (change.type) {
    case 'set-inputs':
      return {
        definition: checked({ ...definition, inputs: change.sourceIds }),
        patch: {
          forward: change,
          inverse: { type: 'set-inputs', sourceIds: definition.inputs },
        },
      }
    case 'set-output':
      return {
        definition: checked({ ...definition, output: change.output }),
        patch: {
          forward: change,
          inverse: { type: 'set-output', output: definition.output },
        },
      }
    case 'replace':
      return {
        definition: checked(change.definition),
        patch: {
          forward: change,
          inverse: { type: 'replace', definition },
        },
      }
    default: {
      const result = planChange(definition.pipeline, change)
      if (result === null) {
        return { definition, patch: { forward: change, inverse: change } }
      }
      return {
        definition: checked({ ...definition, pipeline: result.pipeline }),
        patch: result.patch,
      }
    }
  }
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Applies a change, checking that the result is still a valid workflow. Used for redo and undo too. */
export function applyWorkflowChange(
  definition: WorkflowDefinition,
  change: WorkflowChange,
): WorkflowDefinition {
  return planned(definition, change).definition
}

/**
 * The new workflow and the Edit history patch for a change, or null when the
 * change leaves the workflow as it was, so nothing is recorded.
 */
export function planWorkflowChange(
  definition: WorkflowDefinition,
  change: WorkflowChange,
): { definition: WorkflowDefinition; patch: WorkflowHistoryPatch } | null {
  const result = planned(definition, change)
  if (sameJson(result.definition, WorkflowDefinitionSchema.parse(definition))) {
    return null
  }
  return result
}
