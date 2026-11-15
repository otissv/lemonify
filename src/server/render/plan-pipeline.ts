import { PipelineStepKind } from '@/features/pipeline/pipeline'
import type {
  AiStep,
  PipelineStep,
  SharpStep,
} from '@/features/pipeline/pipeline'
import { stepProblem } from '@/features/pipeline/step-problems'

import { renderKey } from './render-key.ts'
import { resolveOperands } from './resolve-operands.ts'
import type { SourcePathLookup } from './resolve-operands.ts'

export interface PendingAiStep {
  step: AiStep
  key: string
}

export interface StepProblem {
  stepId: string
  message: string
}

/** What planning needs to know about the Document's Source. */
export interface PlanSource {
  contentHash: string
  path: string
}

export interface PlanLookups {
  /** The stored image of an AI Step's Result, found by its key; undefined when none exists yet. */
  aiResultPath(key: string): Promise<string | undefined>
  sourcePath: SourcePathLookup
}

/** What it takes to show a Pipeline: where to start and which steps to apply. */
export interface PipelinePlan {
  sourceHash: string
  /** The image the Sharp steps start from: the Source, or the last AI Step's Result. */
  basePath: string
  /** Sharp steps to apply to the base, with second images already resolved to paths. */
  sharpSteps: ReadonlyArray<SharpStep>
  /** Every step the plan covers, in order; its render key names the image the plan makes. */
  applied: ReadonlyArray<PipelineStep>
  /** Enabled AI Steps with no Result yet, in order, each with the key its Result is stored under. The first is what to run next; later steps wait. */
  pending: ReadonlyArray<PendingAiStep>
  /** Steps left out because they are not set up. */
  skipped: ReadonlyArray<StepProblem>
  /** The key each AI Step's Result is stored under, whether or not it exists yet. */
  aiKeys: ReadonlyMap<string, string>
}

interface UsableSteps {
  usable: Array<PipelineStep>
  resolved: Map<string, SharpStep>
  skipped: Array<StepProblem>
}

async function usableSteps(
  steps: ReadonlyArray<PipelineStep>,
  sourcePath: SourcePathLookup,
): Promise<UsableSteps> {
  const usable: Array<PipelineStep> = []
  const resolved = new Map<string, SharpStep>()
  const skipped: Array<StepProblem> = []
  for (const step of steps) {
    if (!step.enabled) continue
    const problem = stepProblem(step)
    if (problem !== undefined) {
      skipped.push({ stepId: step.id, message: problem })
      continue
    }
    if (step.kind === PipelineStepKind.Sharp) {
      const operands = await resolveOperands(step, sourcePath)
      if (operands.problem !== undefined) {
        skipped.push({ stepId: step.id, message: operands.problem })
        continue
      }
      resolved.set(step.id, operands.step)
    }
    usable.push(step)
  }
  return { usable, resolved, skipped }
}

/**
 * Works out how to show `steps` on a Source. Sharp steps run on the last AI
 * Step that has a Result (or the Source). An AI Step with no Result stops the
 * walk, and everything after it waits.
 */
export async function planPipeline(
  source: PlanSource,
  steps: ReadonlyArray<PipelineStep>,
  lookups: PlanLookups,
): Promise<PipelinePlan> {
  const { usable, resolved, skipped } = await usableSteps(
    steps,
    lookups.sourcePath,
  )
  let basePath = source.path
  let sharpSteps: Array<SharpStep> = []
  const applied: Array<PipelineStep> = []
  const pending: Array<PendingAiStep> = []
  const aiKeys = new Map<string, string>()
  for (const [index, step] of usable.entries()) {
    if (step.kind === PipelineStepKind.Ai) {
      aiKeys.set(
        step.id,
        renderKey(source.contentHash, usable.slice(0, index + 1)),
      )
    }
    if (pending.length > 0) {
      const key = aiKeys.get(step.id)
      if (step.kind === PipelineStepKind.Ai && key !== undefined) {
        pending.push({ step, key })
      }
      continue
    }
    if (step.kind === PipelineStepKind.Sharp) {
      const ready = resolved.get(step.id)
      if (ready) sharpSteps.push(ready)
      applied.push(step)
      continue
    }
    const key = aiKeys.get(step.id)
    if (key === undefined) continue
    const result = await lookups.aiResultPath(key)
    if (result === undefined) {
      pending.push({ step, key })
      continue
    }
    basePath = result
    sharpSteps = []
    applied.push(step)
  }
  return {
    sourceHash: source.contentHash,
    basePath,
    sharpSteps,
    applied,
    pending,
    skipped,
    aiKeys,
  }
}

/** The render key of everything a plan applies. */
export function planKey(plan: PipelinePlan): string {
  return renderKey(plan.sourceHash, plan.applied)
}
