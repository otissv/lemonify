import {
  PipelineStepKind,
  isContainerStep,
  nestingDepth,
} from '@/features/pipeline/pipeline'
import {
  MAX_NESTING_DEPTH,
  TOO_DEEP,
} from '@/features/pipeline/pipeline-limits'
import type {
  ContainerStep,
  Pipeline,
  PipelineStep,
} from '@/features/pipeline/pipeline'

type Steps = ReadonlyArray<PipelineStep>

/** Where a step is: the list it is in (the top, or the container `parentId`) and its place in that list. */
export type StepLocation = {
  step: PipelineStep
  index: number
  parentId?: string
}

function locate(
  steps: Steps,
  id: string,
  parentId: string | undefined,
): StepLocation | undefined {
  for (const [index, step] of steps.entries()) {
    if (step.id === id) {
      return parentId === undefined
        ? { step, index }
        : { step, index, parentId }
    }
    if (!isContainerStep(step)) continue
    const inner = locate(step.steps, id, step.id)
    if (inner !== undefined) return inner
  }
  return undefined
}

/** The step with this id, wherever it is, with the list it is in and its place there. */
export function findStep(
  pipeline: { steps: Steps },
  id: string,
): StepLocation | undefined {
  return locate(pipeline.steps, id, undefined)
}

function ancestors(steps: Steps, id: string): ContainerStep[] | undefined {
  for (const step of steps) {
    if (step.id === id) return []
    if (!isContainerStep(step)) continue
    const inner = ancestors(step.steps, id)
    if (inner !== undefined) return [step, ...inner]
  }
  return undefined
}

/** The containers a step is in, outermost first; empty at the top, undefined when no step has this id. */
export function stepAncestors(
  pipeline: { steps: Steps },
  id: string,
): ContainerStep[] | undefined {
  return ancestors(pipeline.steps, id)
}

/** The steps of a list: the top of the pipeline, or the container `parentId`. Undefined when that is not a container in the pipeline. */
export function childSteps(
  pipeline: { steps: Steps },
  parentId?: string,
): Steps | undefined {
  if (parentId === undefined) return pipeline.steps
  const found = findStep(pipeline, parentId)
  return found !== undefined && isContainerStep(found.step)
    ? found.step.steps
    : undefined
}

function clamp(index: number, length: number): number {
  return Math.min(Math.max(index, 0), length)
}

function mapSteps(
  steps: Steps,
  change: (step: PipelineStep) => PipelineStep,
): PipelineStep[] {
  return steps.map((step) => {
    const next = change(step)
    if (next !== step || !isContainerStep(next)) return next
    const inner = mapSteps(next.steps, change)
    return sameSteps(inner, next.steps) ? next : withChildren(next, inner)
  })
}

function sameSteps(a: Steps, b: Steps): boolean {
  return a.length === b.length && a.every((step, index) => step === b[index])
}

/**
 * A container with these steps. The schema keeps a group from holding an
 * embedded document layer; tree operations only move steps, and the changes
 * that call them check where a step may go.
 */
function withChildren(
  container: ContainerStep,
  steps: PipelineStep[],
): ContainerStep {
  if (container.kind === PipelineStepKind.EmbeddedDocument) {
    return { ...container, steps }
  }
  return { ...container, steps: steps.filter(isGroupMember) }
}

/** Whether a group may hold this step: anything but an embedded document layer. */
export function isGroupMember(
  step: PipelineStep,
): step is Exclude<PipelineStep, { kind: 'embedded-document' }> {
  return step.kind !== PipelineStepKind.EmbeddedDocument
}

/**
 * Adds `step` at `index` (the end by default; out-of-range places are
 * clamped), at the top or, with `parentId`, inside that container. A
 * container that is not there, or a group asked to hold an embedded document
 * layer, leaves the pipeline as it was.
 */
export function insertStep<T extends { steps: Steps }>(
  pipeline: T,
  step: PipelineStep,
  index?: number,
  parentId?: string,
): T {
  if (parentId === undefined) {
    const steps = [...pipeline.steps]
    steps.splice(clamp(index ?? steps.length, steps.length), 0, step)
    return { ...pipeline, steps }
  }
  const parent = findStep(pipeline, parentId)?.step
  if (parent === undefined || !isContainerStep(parent)) return pipeline
  if (parent.kind === PipelineStepKind.Group && !isGroupMember(step)) {
    return pipeline
  }
  return {
    ...pipeline,
    steps: mapSteps(pipeline.steps, (candidate) => {
      if (candidate.id !== parentId || !isContainerStep(candidate)) {
        return candidate
      }
      const steps = [...candidate.steps]
      steps.splice(clamp(index ?? steps.length, steps.length), 0, step)
      return withChildren(candidate, steps)
    }),
  }
}

function without(steps: Steps, id: string): PipelineStep[] {
  const kept: PipelineStep[] = []
  for (const step of steps) {
    if (step.id === id) continue
    if (!isContainerStep(step)) {
      kept.push(step)
      continue
    }
    const inner = without(step.steps, id)
    kept.push(sameSteps(inner, step.steps) ? step : withChildren(step, inner))
  }
  return kept
}

/** Takes a step out of the pipeline, wherever it is; a container goes with everything in it. */
export function removeStep<T extends { steps: Steps }>(
  pipeline: T,
  id: string,
): T {
  return { ...pipeline, steps: without(pipeline.steps, id) }
}

/**
 * Moves a step to `index` in the list it is going to, as that list is after
 * the step is taken out: the top of the pipeline, or inside `parentId`.
 */
export function moveStep<T extends { steps: Steps }>(
  pipeline: T,
  id: string,
  index: number,
  parentId?: string,
): T {
  const found = findStep(pipeline, id)
  if (!found) return pipeline
  return insertStep(removeStep(pipeline, id), found.step, index, parentId)
}

/** Replaces the step with the same id, wherever it is. */
export function replaceStep<T extends { steps: Steps }>(
  pipeline: T,
  next: PipelineStep,
): T {
  return {
    ...pipeline,
    steps: mapSteps(pipeline.steps, (step) =>
      step.id === next.id ? next : step,
    ),
  }
}

export function setStepEnabled<T extends { steps: Steps }>(
  pipeline: T,
  id: string,
  isEnabled: boolean,
): T {
  const found = findStep(pipeline, id)
  if (!found) return pipeline
  return replaceStep(pipeline, { ...found.step, enabled: isEnabled })
}

/** Steps that can go into a new group, and the list they are in. */
export type Groupable = {
  steps: Array<Exclude<PipelineStep, { kind: 'embedded-document' }>>
  parentId: string | undefined
}

/**
 * The steps with these ids when they can be put in a new group: at least one,
 * all in one list and next to each other, none an embedded document layer
 * (which a group cannot hold). They come in pipeline order. Undefined
 * otherwise.
 */
export function groupableSteps(
  pipeline: Pipeline,
  ids: ReadonlyArray<string>,
): Groupable | undefined {
  const [firstId] = ids
  if (firstId === undefined) return undefined
  const parentId = findStep(pipeline, firstId)?.parentId
  const siblings = childSteps(pipeline, parentId) ?? []
  const wanted = new Set(ids)
  const members: Groupable['steps'] = []
  let first = -1
  let last = -1
  for (const [index, step] of siblings.entries()) {
    if (!wanted.has(step.id)) continue
    if (!isGroupMember(step)) return undefined
    if (first === -1) first = index
    last = index
    members.push(step)
  }
  if (members.length !== wanted.size) return undefined
  if (last - first + 1 !== members.length) return undefined
  return { steps: members, parentId }
}

export const PLACE_GONE =
  'That group or embedded document layer is no longer in the pipeline.'
export const PLACE_INSIDE_ITSELF = 'A step cannot go inside itself.'
export const GROUP_HOLDS_NO_EMBEDDED =
  'A group cannot hold an embedded document layer.'

/** Whether a step is, or holds at any depth, an embedded document layer, which a group cannot hold. */
export function holdsEmbedded(step: PipelineStep): boolean {
  if (step.kind === PipelineStepKind.EmbeddedDocument) return true
  return step.kind === PipelineStepKind.Group && step.steps.some(holdsEmbedded)
}

/**
 * Why `step` cannot go in the list `parentId` names (the top when that is
 * undefined), or undefined when it can: the container must be there, must not
 * be the step or inside it, a group gets no embedded document layer, and the
 * nesting stays within the limit. The changes, the sidebar and the diagram all
 * ask this, so they agree.
 */
export function placementProblem(
  pipeline: { steps: Steps },
  step: PipelineStep,
  parentId: string | undefined,
): string | undefined {
  const depth = nestingDepth([step])
  if (parentId === undefined) {
    return depth > MAX_NESTING_DEPTH ? TOO_DEEP : undefined
  }
  const parent = findStep(pipeline, parentId)?.step
  if (parent === undefined || !isContainerStep(parent)) return PLACE_GONE
  const above = stepAncestors(pipeline, parentId) ?? []
  if (parent.id === step.id || above.some(({ id }) => id === step.id)) {
    return PLACE_INSIDE_ITSELF
  }
  if (parent.kind === PipelineStepKind.Group && holdsEmbedded(step)) {
    return GROUP_HOLDS_NO_EMBEDDED
  }
  return above.length + 1 + depth > MAX_NESTING_DEPTH ? TOO_DEEP : undefined
}

/** Where a new step goes: its place in the list of `parentId`, or of the top. */
export type Place = { index: number; parentId?: string }

/**
 * Where a new step goes after the step `afterId`: just after it in its list
 * (at the end of the pipeline when there is no such step). With `into`, a
 * container `afterId` takes the step at its end instead. Where that list
 * cannot hold the step (a group and an embedded document layer, or too deep),
 * it goes after the nearest container around that can.
 */
export function placeAfter(
  pipeline: { steps: Steps },
  step: PipelineStep,
  afterId: string | undefined,
  options: { into?: boolean } = {},
): Place {
  const found = afterId === undefined ? undefined : findStep(pipeline, afterId)
  if (found === undefined) return { index: pipeline.steps.length }
  if (
    options.into === true &&
    isContainerStep(found.step) &&
    placementProblem(pipeline, step, found.step.id) === undefined
  ) {
    return { index: found.step.steps.length, parentId: found.step.id }
  }
  let after: StepLocation = found
  while (
    after.parentId !== undefined &&
    placementProblem(pipeline, step, after.parentId) !== undefined
  ) {
    const outer = findStep(pipeline, after.parentId)
    if (outer === undefined) break
    after = outer
  }
  return after.parentId === undefined
    ? { index: after.index + 1 }
    : { index: after.index + 1, parentId: after.parentId }
}
