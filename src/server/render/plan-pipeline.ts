import { remapPipelineSources } from '@/features/pipeline/image-operands'
import { PipelineStepKind } from '@/features/pipeline/pipeline'
import type {
  AiStep,
  LayerStep,
  PipelineStep,
  SharpStep,
} from '@/features/pipeline/pipeline'
import { stepProblem } from '@/features/pipeline/step-problems'

import { ValidationError } from '../errors.ts'
import type { EngineLayer, EngineStep } from '../tools/image-engine.ts'
import { renderKey } from './render-key.ts'
import type { KeyedStep } from './render-key.ts'
import { resolveOperands } from './resolve-operands.ts'

/** A step that changes the picture; the document's image only chooses what it starts from. */
export type AppliedStep = SharpStep | LayerStep | AiStep

export interface PendingAiStep {
  step: AiStep
  key: string
}

export interface StepProblem {
  stepId: string
  message: string
}

const NO_IMAGE =
  'There is no image to edit. Switch on the document’s image, or replace it.'
const BEFORE_IMAGE = 'Move this step after the document’s image.'
const IMAGE_GONE = 'This image is no longer available.'

/** What planning needs to know about a stored image. */
export interface PlanSource {
  contentHash: string
  path: string
}

export interface PlanLookups {
  /** The stored image of an AI Step's Result, found by its key; undefined when none exists yet. */
  aiResultPath(key: string): Promise<string | undefined>
  /** A stored image's content hash and file, or undefined when it is gone or not the User's. */
  source(sourceId: string): Promise<PlanSource | undefined>
}

/** What it takes to show a Pipeline: where to start and which steps to apply. */
export interface PipelinePlan {
  sourceHash: string
  /** The image the steps start from: the document's image, or the last AI Step's Result. */
  basePath: string
  /** Steps for the engine, in order, with second images and layer images resolved to files. */
  steps: ReadonlyArray<EngineStep>
  /** Every step the plan covers, in order. */
  applied: ReadonlyArray<AppliedStep>
  /** The same steps as the render key sees them: images named by their content, not their id, so a key means the same on every machine. */
  appliedIdentity: ReadonlyArray<KeyedStep>
  /** Enabled AI Steps with no Result yet, in order, each with the key its Result is stored under. The first is what to run next; later steps wait. */
  pending: ReadonlyArray<PendingAiStep>
  /** Steps left out because they are not set up. */
  skipped: ReadonlyArray<StepProblem>
  /** The key each AI Step's Result is stored under, whether or not it exists yet. */
  aiKeys: ReadonlyMap<string, string>
}

interface UsableSteps {
  base: PlanSource
  usable: Array<AppliedStep>
  identity: Map<string, KeyedStep>
  resolved: Map<string, EngineStep>
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

function engineLayer(step: LayerStep, path: string): EngineLayer {
  const { id: _id, enabled: _enabled, sourceId: _sourceId, ...settings } = step
  return { ...settings, path }
}

/** The document's image: the first step, when it is switched on and its image exists. */
async function findBase(
  steps: ReadonlyArray<PipelineStep>,
  lookups: PlanLookups,
): Promise<PlanSource> {
  const first = steps.find((step) => step.kind === PipelineStepKind.Source)
  if (first === undefined || !first.enabled) throw new ValidationError(NO_IMAGE)
  const base = await lookups.source(first.sourceId)
  if (base === undefined) throw new ValidationError(NO_IMAGE)
  return base
}

/** Steps that can be applied, in order, each resolved to what the engine needs. */
async function usableSteps(
  steps: ReadonlyArray<PipelineStep>,
  lookups: PlanLookups,
): Promise<UsableSteps> {
  const base = await findBase(steps, lookups)
  const usable: Array<AppliedStep> = []
  const resolved = new Map<string, EngineStep>()
  const skipped: Array<StepProblem> = []
  const hashes = new Map<string, string>()
  const identity = new Map<string, KeyedStep>()
  const pathOf = async (id: string): Promise<string | undefined> => {
    const source = await lookups.source(id)
    if (source !== undefined) hashes.set(id, source.contentHash)
    return source?.path
  }
  let reachedImage = false
  for (const step of steps) {
    if (step.kind === PipelineStepKind.Source) {
      reachedImage = true
      continue
    }
    if (!step.enabled) continue
    if (!reachedImage) {
      skipped.push({ stepId: step.id, message: BEFORE_IMAGE })
      continue
    }
    const problem = stepProblem(step)
    if (problem !== undefined) {
      skipped.push({ stepId: step.id, message: problem })
      continue
    }
    if (step.kind === PipelineStepKind.Layer) {
      const path = await pathOf(step.sourceId)
      if (path === undefined) {
        skipped.push({ stepId: step.id, message: IMAGE_GONE })
        continue
      }
      resolved.set(step.id, engineLayer(step, path))
      identity.set(step.id, {
        ...step,
        sourceId: hashes.get(step.sourceId) ?? step.sourceId,
      })
    }
    if (step.kind === PipelineStepKind.Sharp) {
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
 * Works out how to show `steps`. The first step is the document's image. The
 * steps after it run on the last AI Step that has a Result (or on the image):
 * Sharp steps change the picture, layers are drawn onto it. An AI Step with no
 * Result stops the walk, and everything after it waits. Throws when the
 * document has no image to start from.
 */
export async function planPipeline(
  steps: ReadonlyArray<PipelineStep>,
  lookups: PlanLookups,
): Promise<PipelinePlan> {
  const { base, usable, identity, resolved, skipped } = await usableSteps(
    steps,
    lookups,
  )
  let basePath = base.path
  let engineSteps: Array<EngineStep> = []
  const applied: Array<AppliedStep> = []
  const appliedIdentity: Array<KeyedStep> = []
  const identityOf = (step: AppliedStep): KeyedStep =>
    identity.get(step.id) ?? step
  const pending: Array<PendingAiStep> = []
  const aiKeys = new Map<string, string>()
  for (const [index, step] of usable.entries()) {
    if (step.kind === PipelineStepKind.Ai) {
      aiKeys.set(
        step.id,
        renderKey(base.contentHash, usable.slice(0, index + 1).map(identityOf)),
      )
    }
    if (pending.length > 0) {
      const key = aiKeys.get(step.id)
      if (step.kind === PipelineStepKind.Ai && key !== undefined) {
        pending.push({ step, key })
      }
      continue
    }
    if (step.kind !== PipelineStepKind.Ai) {
      const ready = resolved.get(step.id)
      if (ready) engineSteps.push(ready)
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
    engineSteps = []
    applied.push(step)
    appliedIdentity.push(step)
  }
  return {
    sourceHash: base.contentHash,
    basePath,
    steps: engineSteps,
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
