import { canvasIdentity } from '@/features/pipeline/canvas'
import type { Canvas } from '@/features/pipeline/canvas'
import { isLayerStep, layerKind } from '@/features/pipeline/layer-kinds'
import type {
  ImageLookup,
  ImageLayerStep,
} from '@/features/pipeline/layer-kinds'
import { remapStepSources } from '@/features/pipeline/image-operands'
import { PipelineStepKind } from '@/features/pipeline/pipeline'
import { layerSettingsOf } from '@/features/pipeline/layer'
import type {
  AiStep,
  GroupStep,
  PlanStep,
  SharpStep,
} from '@/features/pipeline/pipeline'
import { stepProblem } from '@/features/pipeline/step-problems'

import type {
  EngineBase,
  EngineLayer,
  EngineStep,
} from '../tools/image-engine.ts'
import { renderKey } from './render-key.ts'
import type { KeyedStep } from './render-key.ts'
import { resolveOperands } from './resolve-operands.ts'

/** A step that changes the picture: a Sharp tool, a layer drawn on it, an AI tool, or a sub-document placed on it like a layer. */
export type AppliedStep = SharpStep | ImageLayerStep | AiStep | GroupStep

export interface PendingAiStep {
  step: AiStep
  key: string
}

export interface StepProblem {
  stepId: string
  message: string
}

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
  /** What the base is, as the render key sees it: the canvas, which is the same wherever the pipeline is. */
  baseKey: string
  /** What the steps start from: the blank canvas, or the last AI Step's Result. */
  base: EngineBase
  /** The first image the pipeline draws, whose format an export "same as original" keeps. */
  originalFrom: string | undefined
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
  originalFrom: string | undefined
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
  const renamed = remapStepSources(step, hashes)
  return renamed.kind === PipelineStepKind.Sharp ? renamed : step
}

/** A drawn layer for the engine: its image as a file, placed by the layer's settings. */
function engineLayer(step: ImageLayerStep, path: string): EngineLayer {
  return { kind: 'layer', path, ...layerSettingsOf(step) }
}

/** The sub-document's own plan: its steps on a picture the size of the canvas it is placed on. */
function planSubDocument(
  group: GroupStep,
  canvas: Canvas,
  lookups: PlanLookups,
): Promise<PipelinePlan> {
  return planPipeline(canvas, group.steps, lookups)
}

/** Steps that can be applied, in order, each resolved to what the engine needs. */
async function usableSteps(
  canvas: Canvas,
  steps: ReadonlyArray<PlanStep>,
  lookups: PlanLookups,
): Promise<UsableSteps> {
  const usable: Array<AppliedStep> = []
  const resolved = new Map<string, EngineStep>()
  const skipped: Array<StepProblem> = []
  const hashes = new Map<string, string>()
  const identity = new Map<string, KeyedStep>()
  const subPlans = new Map<string, PipelinePlan>()
  const imageOf: ImageLookup = async (id) => {
    const source = await lookups.source(id)
    if (source !== undefined) hashes.set(id, source.contentHash)
    return source
  }
  const pathOf = async (id: string): Promise<string | undefined> =>
    (await imageOf(id))?.path
  let originalFrom: string | undefined
  for (const step of steps) {
    if (!step.enabled) continue
    if (step.kind === PipelineStepKind.Group) {
      const inner = await planSubDocument(step, canvas, lookups)
      skipped.push(...inner.skipped)
      subPlans.set(step.id, inner)
      resolved.set(step.id, {
        ...layerSettingsOf(step),
        kind: 'sub-document',
        input: inner.base,
        steps: inner.steps,
      })
      identity.set(step.id, {
        ...layerSettingsOf(step),
        kind: PipelineStepKind.Group,
        base: inner.baseKey,
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
    if (isLayerStep(step)) {
      const plan = await layerKind(step).plan(step, imageOf)
      if (plan.state === 'empty') continue
      if (plan.state === 'gone') {
        skipped.push({ stepId: step.id, message: IMAGE_GONE })
        continue
      }
      originalFrom ??= plan.path
      resolved.set(step.id, engineLayer(step, plan.path))
      identity.set(step.id, plan.identity)
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
  return { originalFrom, usable, identity, resolved, skipped, subPlans }
}

/**
 * Works out how to show `steps` on `canvas`. The picture starts as the blank
 * canvas, and the steps run on it in order, up to the last AI Step that has a
 * Result (which then is what they start from): Sharp steps change the picture
 * and layers are drawn onto it. An AI Step with no Result stops the walk, and
 * everything after it waits.
 */
export async function planPipeline(
  canvas: Canvas,
  steps: ReadonlyArray<PlanStep>,
  lookups: PlanLookups,
): Promise<PipelinePlan> {
  const { originalFrom, usable, identity, resolved, skipped, subPlans } =
    await usableSteps(canvas, steps, lookups)
  const baseKey = canvasIdentity(canvas)
  let base: EngineBase = { kind: 'canvas', canvas }
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
        renderKey(baseKey, usable.slice(0, index + 1).map(identityOf)),
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
    base = { kind: 'file', path: result }
    engineSteps = []
    applied.push(step)
    appliedIdentity.push(step)
  }
  return {
    baseKey,
    base,
    originalFrom,
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
  return renderKey(plan.baseKey, plan.appliedIdentity)
}
