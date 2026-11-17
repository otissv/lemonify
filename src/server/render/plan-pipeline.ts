import { remapPipelineSources } from '@/features/pipeline/image-operands'
import { PipelineStepKind } from '@/features/pipeline/pipeline'
import type { LayerSettings } from '@/features/pipeline/layer'
import type {
  AiStep,
  GroupStep,
  LayerStep,
  PlanStep,
  SharpStep,
} from '@/features/pipeline/pipeline'
import { stepProblem } from '@/features/pipeline/step-problems'

import { ValidationError } from '../errors.ts'
import type { EngineLayer, EngineStep } from '../tools/image-engine.ts'
import { renderKey } from './render-key.ts'
import type { KeyedStep } from './render-key.ts'
import { resolveOperands } from './resolve-operands.ts'

/** A step that changes the picture; the canvas layer only chooses what it starts from. A group is a sub-document, placed on the picture like a layer. */
export type AppliedStep = SharpStep | LayerStep | AiStep | GroupStep

export interface PendingAiStep {
  step: AiStep
  key: string
}

export interface StepProblem {
  stepId: string
  message: string
}

const NO_IMAGE =
  'There is no image to edit. Add an image as a layer, or switch one on.'
const BEFORE_IMAGE = 'Move this step after the first layer.'
const IMAGE_GONE = 'This image is no longer available.'
const GROUP_NO_IMAGE =
  'No layer in this group is on, so it has no picture. Switch one on, or add one.'

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
  /** The image the steps start from: the canvas layer's image, or the last AI Step's Result. */
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
  /** The key each AI Step's Result is stored under, whether or not it exists yet, including those of the steps in sub-documents. */
  aiKeys: ReadonlyMap<string, string>
  /** The plan of each sub-document that is applied or waiting, by group id: its own picture, steps and AI steps. */
  subPlans: ReadonlyMap<string, PipelinePlan>
  /** Every step that can be applied, as the key sees it, whether or not it waits for an AI step before it. */
  fullIdentity: ReadonlyArray<KeyedStep>
}

interface UsableSteps {
  base: PlanSource
  usable: Array<AppliedStep>
  identity: Map<string, KeyedStep>
  resolved: Map<string, EngineStep>
  skipped: Array<StepProblem>
  subPlans: Map<string, PipelinePlan>
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

function placement(group: GroupStep): LayerSettings {
  const { opacity, blend, fit, scale, rotation, anchor, x, y } = group
  return { opacity, blend, fit, scale, rotation, anchor, x, y }
}

/** The sub-document's own plan, or why it has none: with no layer on there is no picture to make. */
async function planSubDocument(
  group: GroupStep,
  lookups: PlanLookups,
): Promise<PipelinePlan | StepProblem> {
  try {
    return await planPipeline(group.steps, lookups)
  } catch (error) {
    if (error instanceof ValidationError && error.message === NO_IMAGE) {
      return { stepId: group.id, message: GROUP_NO_IMAGE }
    }
    throw error
  }
}

/** Steps that can be applied, in order, each resolved to what the engine needs. The first layer that is switched on and still has its image is the canvas and is not applied: it is the picture the rest start from. */
async function usableSteps(
  steps: ReadonlyArray<PlanStep>,
  lookups: PlanLookups,
): Promise<UsableSteps> {
  const usable: Array<AppliedStep> = []
  const resolved = new Map<string, EngineStep>()
  const skipped: Array<StepProblem> = []
  const hashes = new Map<string, string>()
  const identity = new Map<string, KeyedStep>()
  const subPlans = new Map<string, PipelinePlan>()
  const pathOf = async (id: string): Promise<string | undefined> => {
    const source = await lookups.source(id)
    if (source !== undefined) hashes.set(id, source.contentHash)
    return source?.path
  }
  let base: PlanSource | undefined
  for (const step of steps) {
    if (!step.enabled) continue
    if (step.kind === PipelineStepKind.Layer && base === undefined) {
      const source = await lookups.source(step.sourceId)
      if (source === undefined) {
        skipped.push({ stepId: step.id, message: IMAGE_GONE })
        continue
      }
      base = source
      continue
    }
    if (base === undefined) {
      skipped.push({ stepId: step.id, message: BEFORE_IMAGE })
      continue
    }
    if (step.kind === PipelineStepKind.Group) {
      const inner = await planSubDocument(step, lookups)
      if ('message' in inner) {
        skipped.push(inner)
        continue
      }
      skipped.push(...inner.skipped)
      subPlans.set(step.id, inner)
      resolved.set(step.id, {
        ...placement(step),
        kind: 'sub-document',
        input: inner.basePath,
        steps: inner.steps,
      })
      identity.set(step.id, {
        ...placement(step),
        kind: PipelineStepKind.Group,
        source: inner.sourceHash,
        steps: inner.fullIdentity,
      })
      usable.push(step)
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
  if (base === undefined) throw new ValidationError(NO_IMAGE)
  return { base, usable, identity, resolved, skipped, subPlans }
}

/**
 * Works out how to show `steps`. The first layer that is switched on is the
 * canvas: its image, at its own size, is what the steps after it start from.
 * They run on the last AI Step that has a Result (or on that image): Sharp
 * steps change the picture, layers are drawn onto it. Steps before the canvas
 * layer have nothing to work on and are skipped. An AI Step with no Result
 * stops the walk, and everything after it waits. Throws when there is no
 * image to start from.
 */
export async function planPipeline(
  steps: ReadonlyArray<PlanStep>,
  lookups: PlanLookups,
): Promise<PipelinePlan> {
  const { base, usable, identity, resolved, skipped, subPlans } =
    await usableSteps(steps, lookups)
  let basePath = base.path
  let engineSteps: Array<EngineStep> = []
  const applied: Array<AppliedStep> = []
  const appliedIdentity: Array<KeyedStep> = []
  const identityOf = (step: AppliedStep): KeyedStep => {
    const known = identity.get(step.id)
    if (known !== undefined) return known
    if (step.kind === PipelineStepKind.Group) {
      throw new Error('A sub-document was applied without being planned.')
    }
    return step
  }
  const pending: Array<PendingAiStep> = []
  const aiKeys = new Map<string, string>()
  for (const [index, step] of usable.entries()) {
    const inner = subPlans.get(step.id)
    if (inner !== undefined) {
      for (const [id, key] of inner.aiKeys) aiKeys.set(id, key)
    }
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
      if (inner !== undefined) pending.push(...inner.pending)
      continue
    }
    if (inner !== undefined && inner.pending.length > 0) {
      pending.push(...inner.pending)
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
    subPlans,
    fullIdentity: usable.map(identityOf),
  }
}

/**
 * The plan whose picture an AI step works on when it runs: the plan of the
 * sub-document that holds it, or `plan` itself. Undefined when the step is
 * not waiting in `plan`.
 */
export function awaitingPlan(
  plan: PipelinePlan,
  stepId: string,
): PipelinePlan | undefined {
  for (const inner of plan.subPlans.values()) {
    const found = awaitingPlan(inner, stepId)
    if (found !== undefined) return found
  }
  return plan.pending.some(({ step }) => step.id === stepId) ? plan : undefined
}

/** The render key of everything a plan applies. */
export function planKey(plan: PipelinePlan): string {
  return renderKey(plan.sourceHash, plan.appliedIdentity)
}
