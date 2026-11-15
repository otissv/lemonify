import { AI_TOOLS } from '@/features/ai/ai-tools'
import { PipelineStepKind } from '@/features/pipeline/pipeline'
import type { PipelineStep } from '@/features/pipeline/pipeline'
import {
  missingSharpOptions,
  opLabel,
  sharpOptionProblems,
} from '@/features/workflows/sharp-op-fields'

const GENERAL = '_'

/**
 * Why a step cannot be applied yet, in plain words, or undefined when it is
 * set up. Uses the image CLI's own checks, so the preview and the CLI agree.
 */
export function stepProblem(step: PipelineStep): string | undefined {
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
  return step.kind === PipelineStepKind.Sharp
    ? opLabel(step.op)
    : AI_TOOLS[step.tool].label
}
