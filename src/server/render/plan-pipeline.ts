import { canvasIdentity } from '@/features/pipeline/canvas'
import type { Canvas } from '@/features/pipeline/canvas'
import { isLayerStep, layerKind } from '@/features/pipeline/layer-kinds'
import type {
  ImageLookup,
  LayerStep,
  UsedItem,
} from '@/features/pipeline/layer-kinds'
import { MAX_NESTING_DEPTH } from '@/features/pipeline/pipeline-limits'
import { remapStepSources } from '@/features/pipeline/image-operands'
import { PipelineStepKind, planSteps } from '@/features/pipeline/pipeline'
import { layerSettingsOf } from '@/features/pipeline/layer'
import type {
  AiStep,
  EmbeddedDocumentStep,
  PlanStep,
  SharpStep,
} from '@/features/pipeline/pipeline'
import { stepProblem } from '@/features/pipeline/step-problems'

import type {
  EngineBase,
  EngineLayer,
  EngineStep,
} from '../tools/image-engine.ts'
import { USED_PICTURE, renderKey } from './render-key.ts'
import type { KeyedStep } from './render-key.ts'
import { resolveOperands } from './resolve-operands.ts'

/** A step that changes the picture: a Sharp tool, a layer drawn on it, an AI tool, or an embedded document layer placed on it like a layer. */
export type AppliedStep = SharpStep | LayerStep | AiStep | EmbeddedDocumentStep

export interface PendingAiStep {
  step: AiStep
  key: string
  /** The used document that runs and keeps the step, when it is inside a document layer; the document being planned otherwise. */
  documentId?: string
}

export interface StepProblem {
  stepId: string
  message: string
}

const IMAGE_GONE = 'This image is no longer available.'
const DOCUMENT_GONE = 'That document is no longer available.'
const WORKFLOW_GONE = 'That workflow is no longer available.'
const TOO_DEEP_USED = `Layers that use other documents and workflows go at most ${MAX_NESTING_DEPTH} deep.`

/** What planning needs to know about a stored image. */
export interface PlanSource {
  contentHash: string
  path: string
  width: number
  height: number
}

/** The picture a document layer or workflow layer draws: the used item's steps on its own canvas. */
export interface UsedPicture {
  canvas: Canvas
  steps: ReadonlyArray<PlanStep>
}

export interface PlanLookups {
  /** The stored image of an AI Step's Result, found by its key; undefined when none exists yet. */
  aiResultPath(key: string): Promise<string | undefined>
  /** A stored image's content hash and file, or undefined when it is gone or not the User's. */
  source(sourceId: string): Promise<PlanSource | undefined>
  /** The picture a document layer or workflow layer draws, or undefined when what it uses is gone or not the User's. */
  used(item: UsedItem): Promise<UsedPicture | undefined>
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
  /** The document layers and workflow layers, at any depth of groups and embedded document layers, whose picture waits for an AI step in what they use. */
  waitingLayerIds: ReadonlyArray<string>
  /** Steps left out because they are not set up. */
  skipped: ReadonlyArray<StepProblem>
  /** The key each AI Step's Result is stored under, whether or not it exists yet, including those of the steps in embedded document layers. */
  aiKeys: ReadonlyMap<string, string>
  /** The document that owns each AI Step inside a document layer, at any depth, by step id: it runs and keeps that Result. A step not in it belongs to the item being planned. */
  aiOwners: ReadonlyMap<string, string>
  /** The plan of each embedded document layer that is applied or waiting, by its step id: its own picture, steps and AI steps. */
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
function engineLayer(step: LayerStep, path: string): EngineLayer {
  return { kind: 'layer', path, ...layerSettingsOf(step) }
}

/** The embedded document layer's own plan: its steps, groups opened and embedded document layers in it planned in turn, on a picture the size of the canvas it is placed on. */
function planEmbeddedDocument(
  embedded: EmbeddedDocumentStep,
  canvas: Canvas,
  lookups: PlanLookups,
  depth: number,
): Promise<PipelinePlan> {
  return planPipeline(canvas, planSteps(embedded), lookups, depth)
}

/** The plan of a used document, whose AI steps that document runs and keeps. */
function ownedBy(plan: PipelinePlan, item: UsedItem): PipelinePlan {
  if (item.kind !== 'document') return plan
  const aiOwners = new Map(plan.aiOwners)
  for (const stepId of plan.aiKeys.keys()) {
    if (!aiOwners.has(stepId)) aiOwners.set(stepId, item.documentId)
  }
  const pending: PendingAiStep[] = []
  for (const waiting of plan.pending) {
    pending.push(
      waiting.documentId === undefined
        ? { ...waiting, documentId: item.documentId }
        : waiting,
    )
  }
  return { ...plan, pending, aiOwners }
}

/** The plan of what a document layer or workflow layer draws, or why it cannot be drawn. */
async function planUsed(
  item: UsedItem,
  lookups: PlanLookups,
  depth: number,
): Promise<PipelinePlan | string> {
  if (depth >= MAX_NESTING_DEPTH) return TOO_DEEP_USED
  const used = await lookups.used(item)
  if (used === undefined) {
    return item.kind === 'document' ? DOCUMENT_GONE : WORKFLOW_GONE
  }
  const inner = await planPipeline(used.canvas, used.steps, lookups, depth + 1)
  return ownedBy(inner, item)
}

/** Steps that can be applied, in order, each resolved to what the engine needs. */
async function usableSteps(
  canvas: Canvas,
  steps: ReadonlyArray<PlanStep>,
  lookups: PlanLookups,
  depth: number,
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
    if (step.kind === PipelineStepKind.EmbeddedDocument) {
      const inner = await planEmbeddedDocument(step, canvas, lookups, depth)
      skipped.push(...inner.skipped)
      subPlans.set(step.id, inner)
      resolved.set(step.id, {
        ...layerSettingsOf(step),
        kind: 'embedded-document',
        input: inner.base,
        steps: inner.steps,
      })
      identity.set(step.id, {
        ...layerSettingsOf(step),
        kind: PipelineStepKind.EmbeddedDocument,
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
      if (plan.state === 'used') {
        const inner = await planUsed(plan.item, lookups, depth)
        if (typeof inner === 'string') {
          skipped.push({ stepId: step.id, message: inner })
          continue
        }
        skipped.push(...inner.skipped)
        subPlans.set(step.id, inner)
        resolved.set(step.id, {
          ...layerSettingsOf(step),
          kind: 'embedded-document',
          input: inner.base,
          steps: inner.steps,
        })
        identity.set(step.id, {
          ...layerSettingsOf(step),
          kind: USED_PICTURE,
          base: inner.baseKey,
          steps: inner.fullIdentity,
        })
        usable.push(step)
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
  /** How many document layers and workflow layers lead to this pipeline. */
  depth = 0,
): Promise<PipelinePlan> {
  const { originalFrom, usable, identity, resolved, skipped, subPlans } =
    await usableSteps(canvas, steps, lookups, depth)
  const baseKey = canvasIdentity(canvas)
  let base: EngineBase = { kind: 'canvas', canvas }
  let engineSteps: Array<EngineStep> = []
  const applied: Array<AppliedStep> = []
  const appliedIdentity: Array<KeyedStep> = []
  const identityOf = (step: AppliedStep): KeyedStep => {
    const known = identity.get(step.id)
    if (known !== undefined) return known
    if (step.kind === PipelineStepKind.EmbeddedDocument) {
      throw new Error(
        'An embedded document layer was applied without being planned.',
      )
    }
    return step
  }
  const pending: Array<PendingAiStep> = []
  const waitingLayerIds: Array<string> = []
  const aiKeys = new Map<string, string>()
  const aiOwners = new Map<string, string>()
  for (const [index, step] of usable.entries()) {
    const inner = subPlans.get(step.id)
    if (inner !== undefined) {
      for (const [id, key] of inner.aiKeys) aiKeys.set(id, key)
      for (const [id, owner] of inner.aiOwners) aiOwners.set(id, owner)
      if (isLayerStep(step) && inner.pending.length > 0) {
        waitingLayerIds.push(step.id)
      }
      waitingLayerIds.push(...inner.waitingLayerIds)
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
    waitingLayerIds,
    skipped,
    aiKeys,
    aiOwners,
    subPlans,
    fullIdentity: usable.map(identityOf),
  }
}

/**
 * The plan whose picture the waiting AI step with Result key `key` works on
 * when it runs: the plan of the embedded document layer, document layer or
 * workflow layer that holds it, or `plan` itself. A key names one step on one
 * picture, so a workflow used twice has a plan for each. Undefined when no
 * step with that key waits in `plan`.
 */
export function awaitingPlan(
  plan: PipelinePlan,
  key: string,
): PipelinePlan | undefined {
  for (const inner of plan.subPlans.values()) {
    const found = awaitingPlan(inner, key)
    if (found !== undefined) return found
  }
  return plan.pending.some((waiting) => waiting.key === key) ? plan : undefined
}

/** The render key of everything a plan applies. */
export function planKey(plan: PipelinePlan): string {
  return renderKey(plan.baseKey, plan.appliedIdentity)
}
