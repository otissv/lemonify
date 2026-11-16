import { PipelineStepKind } from '@/features/pipeline/pipeline'
import type {
  AiStep,
  PipelineStep,
  SharpStep,
} from '@/features/pipeline/pipeline'
import {
  remapPipelineSources,
  stepOperandSourceIds,
} from '@/features/pipeline/image-operands'
import { stepProblem } from '@/features/pipeline/step-problems'

import { ValidationError } from '../errors.ts'
import { renderKey } from './render-key.ts'
import { resolveOperands } from './resolve-operands.ts'

/** A step that changes the picture; Open image steps only choose which image it starts from. */
export type AppliedStep = SharpStep | AiStep

export interface PendingAiStep {
  step: AiStep
  key: string
}

export interface StepProblem {
  stepId: string
  message: string
}

const NO_IMAGE =
  'There is no image to edit. Switch on an Open image step, or add one.'
const NOT_OPEN_YET = 'Open an image first.'
const IMAGE_GONE = 'This image is no longer available.'
const OPERAND_NOT_OPEN = 'Open that image earlier in the pipeline first.'

/** What planning needs to know about an opened Source. */
export interface PlanSource {
  contentHash: string
  path: string
}

export interface PlanLookups {
  /** The stored image of an AI Step's Result, found by its key; undefined when none exists yet. */
  aiResultPath(key: string): Promise<string | undefined>
  /** An opened Source's content hash and file, or undefined when it is gone or not the User's. */
  source(sourceId: string): Promise<PlanSource | undefined>
}

/** What it takes to show a Pipeline: where to start and which steps to apply. */
export interface PipelinePlan {
  sourceHash: string
  /** The image the Sharp steps start from: the Source, or the last AI Step's Result. */
  basePath: string
  /** Sharp steps to apply to the base, with second images already resolved to paths. */
  sharpSteps: ReadonlyArray<SharpStep>
  /** Every step the plan covers, in order. */
  applied: ReadonlyArray<AppliedStep>
  /** The same steps as the render key sees them: second images named by their content, not their id, so a key means the same on every machine. */
  appliedIdentity: ReadonlyArray<AppliedStep>
  /** Enabled AI Steps with no Result yet, in order, each with the key its Result is stored under. The first is what to run next; later steps wait. */
  pending: ReadonlyArray<PendingAiStep>
  /** Steps left out because they are not set up. */
  skipped: ReadonlyArray<StepProblem>
  /** The key each AI Step's Result is stored under, whether or not it exists yet. */
  aiKeys: ReadonlyMap<string, string>
}

interface UsableSteps {
  base: PlanSource | undefined
  usable: Array<AppliedStep>
  identity: Map<string, AppliedStep>
  resolved: Map<string, SharpStep>
  skipped: Array<StepProblem>
}

/** The step with its second images named by their content hash, which is the same wherever the image is stored. */
function contentIdentity(
  step: SharpStep,
  hashes: ReadonlyMap<string, string>,
): SharpStep {
  const [renamed] = remapPipelineSources({ steps: [step] }, hashes).steps
  return renamed?.kind === PipelineStepKind.Sharp ? renamed : step
}

/** Steps that can be applied, in order, with the first opened image as the base. Open image steps open images and are not applied. */
async function usableSteps(
  steps: ReadonlyArray<PipelineStep>,
  lookups: PlanLookups,
): Promise<UsableSteps> {
  const usable: Array<AppliedStep> = []
  const resolved = new Map<string, SharpStep>()
  const skipped: Array<StepProblem> = []
  const opened = new Set<string>()
  const hashes = new Map<string, string>()
  const identity = new Map<string, AppliedStep>()
  let base: PlanSource | undefined
  const pathOf = async (id: string): Promise<string | undefined> =>
    (await lookups.source(id))?.path
  for (const step of steps) {
    if (!step.enabled) continue
    if (step.kind === PipelineStepKind.Source) {
      const source = await lookups.source(step.sourceId)
      if (source === undefined) {
        skipped.push({ stepId: step.id, message: IMAGE_GONE })
        continue
      }
      opened.add(step.sourceId)
      hashes.set(step.sourceId, source.contentHash)
      base ??= source
      continue
    }
    if (base === undefined) {
      skipped.push({ stepId: step.id, message: NOT_OPEN_YET })
      continue
    }
    const problem = stepProblem(step)
    if (problem !== undefined) {
      skipped.push({ stepId: step.id, message: problem })
      continue
    }
    if (step.kind === PipelineStepKind.Sharp) {
      if (!stepOperandSourceIds(step).every((id) => opened.has(id))) {
        skipped.push({ stepId: step.id, message: OPERAND_NOT_OPEN })
        continue
      }
      const operands = await resolveOperands(step, pathOf)
      if (operands.problem !== undefined) {
        skipped.push({ stepId: step.id, message: operands.problem })
        continue
      }
      resolved.set(step.id, operands.step)
      identity.set(step.id, contentIdentity(step, hashes))
    }
    usable.push(step)
  }
  return { base, usable, identity, resolved, skipped }
}

/**
 * Works out how to show `steps`. The first Open image step that is switched on
 * gives the image; later ones only make their images available to the steps
 * after them. Sharp steps run on the last AI Step that has a Result (or that
 * image). An AI Step with no Result stops the walk, and everything after it
 * waits. Throws when no image is opened.
 */
export async function planPipeline(
  steps: ReadonlyArray<PipelineStep>,
  lookups: PlanLookups,
): Promise<PipelinePlan> {
  const {
    base: source,
    usable,
    identity,
    resolved,
    skipped,
  } = await usableSteps(steps, lookups)
  if (source === undefined) throw new ValidationError(NO_IMAGE)
  let basePath = source.path
  let sharpSteps: Array<SharpStep> = []
  const applied: Array<AppliedStep> = []
  const appliedIdentity: Array<AppliedStep> = []
  const identityOf = (step: AppliedStep): AppliedStep =>
    identity.get(step.id) ?? step
  const pending: Array<PendingAiStep> = []
  const aiKeys = new Map<string, string>()
  for (const [index, step] of usable.entries()) {
    if (step.kind === PipelineStepKind.Ai) {
      aiKeys.set(
        step.id,
        renderKey(
          source.contentHash,
          usable.slice(0, index + 1).map(identityOf),
        ),
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
      appliedIdentity.push(identityOf(step))
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
    appliedIdentity.push(step)
  }
  return {
    sourceHash: source.contentHash,
    basePath,
    sharpSteps,
    applied,
    appliedIdentity,
    pending,
    skipped,
    aiKeys,
  }
}

/** The render key of everything a plan applies. */
export function planKey(plan: PipelinePlan): string {
  return renderKey(plan.sourceHash, plan.appliedIdentity)
}
