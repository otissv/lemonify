import { AI_TOOLS } from '@/features/ai/ai-tools'
import { PipelineStepKind } from '@/features/pipeline/pipeline'
import type { LeafStep, PipelineStep } from '@/features/pipeline/pipeline'
import {
  missingSharpOptions,
  opLabel,
  sharpOptionProblems,
} from '@/features/workflows/sharp-op-fields'

const GENERAL = '_'

export const LAYER_LABEL = 'Layer'
export const GROUP_LABEL = 'Group'

/**
 * Why a step cannot be applied yet, in plain words, or undefined when it is
 * set up. Uses the image CLI's own checks, so the preview and the CLI agree.
 */
export function stepProblem(step: LeafStep): string | undefined {
  if (step.kind !== PipelineStepKind.Sharp) return undefined
  const missing = missingSharpOptions(step.op, step.options)
  if (missing.length > 0) return `Needs ${missing.join(', ')}.`
  const problems = sharpOptionProblems(step.op, step.options)
  const general = problems[GENERAL]
  if (general) return general
  const first = Object.entries(problems).at(0)
  if (!first) return undefined
  return `${first[0]}: ${first[1]}`
}

/** "Blur" or "Auto orient": the name a step is shown by. */
export function pipelineStepLabel(step: PipelineStep): string {
  switch (step.kind) {
    case PipelineStepKind.Group:
      return GROUP_LABEL
    case PipelineStepKind.Layer:
      return LAYER_LABEL
    case PipelineStepKind.Sharp:
      return opLabel(step.op)
    case PipelineStepKind.Ai:
      return AI_TOOLS[step.tool].label
  }
}

/** What a step is called: the name it was given, or else its tool's name. */
export function pipelineStepTitle(step: PipelineStep): string {
  return step.name ?? pipelineStepLabel(step)
}
