import { aiToolSchema } from '@/features/ai/ai-tools'
import type { DocumentChange } from '@/features/pipeline/document-change'
import { DEFAULT_LAYER_SETTINGS } from '@/features/pipeline/layer'
import {
  PipelineStepKind,
  PipelineStepSchema,
  originalSourceId,
} from '@/features/pipeline/pipeline'
import type { Pipeline, PipelineStep } from '@/features/pipeline/pipeline'
import { startingSharpOptions } from '@/features/pipeline/sharp-starting-options'
import type { PictureSize } from '@/features/pipeline/canvas'
import type { z } from 'zod'

/** An AI tool and the settings its catalogue starts a new step with. */
export const AiStartingSchema = aiToolSchema({})

export type AiStarting = z.output<typeof AiStartingSchema>

type ResetChange = Extract<DocumentChange, { type: 'reset-step' }>

/** What a step starts from that the pipeline alone does not say. */
export interface ResetStarting {
  /** The settings an AI step's catalogue starts from. */
  ai?: AiStarting
  /** The size of the picture the step acts on, which a resize starts at. */
  size?: PictureSize
}

/** The change that resets a step; an AI step needs the settings its catalogue starts from, and a resize the size of its picture. */
export function resetChangeFor(
  step: PipelineStep,
  { ai, size }: ResetStarting = {},
): ResetChange {
  return {
    type: 'reset-step',
    stepId: step.id,
    ...(ai === undefined ? {} : { ai }),
    ...(size === undefined ? {} : { size }),
  }
}

/**
 * A step as a new one of its kind starts, keeping what makes it this step: its
 * id, name, whether it is on, a layer's image and a group's steps. A Sharp step
 * gets the options the website starts it with (a resize the size given) and loses its blend; an AI step
 * the settings given; a layer, or a group, the default placement. Undefined
 * when an AI step is not given settings for its own tool.
 */
export function resetStep(
  pipeline: Pipeline,
  step: PipelineStep,
  { ai, size }: ResetStarting,
): PipelineStep | undefined {
  if (step.kind === PipelineStepKind.Sharp) {
    const { blend: _blend, ...unblended } = step
    const imageId = originalSourceId(pipeline)
    const options = startingSharpOptions(step.op, { imageId, size })
    return { ...unblended, options }
  }
  if (step.kind === PipelineStepKind.Ai) {
    if (ai === undefined || ai.tool !== step.tool) return undefined
    return PipelineStepSchema.parse({ ...step, ...ai })
  }
  return { ...step, ...DEFAULT_LAYER_SETTINGS }
}
