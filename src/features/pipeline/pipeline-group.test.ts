import { describe, expect, it } from 'vitest'

import { DEFAULT_LAYER_SETTINGS } from '@/features/pipeline/layer'
import {
  EmbeddedDocumentStepSchema,
  GroupStepSchema,
  MAX_GROUP_STEPS,
  MAX_NESTING_DEPTH,
  MAX_PIPELINE_STEPS,
  PipelineSchema,
  PipelineStepKind,
  childSteps,
  copyStep,
  createEmbeddedDocumentStep,
  createGroupStep,
  createSharpStep,
  effectiveSteps,
  findStep,
  firstImageLayer,
  groupableSteps,
  hasEdits,
  insertStep,
  isContainerStep,
  isGroupMember,
  leafSteps,
  moveStep,
  nestingDepth,
  placeAfter,
  placementProblem,
  planSteps,
  removeStep,
  replaceStep,
  setStepEnabled,
  stepAncestors,
} from '@/features/pipeline/pipeline'
import type { PipelineStep } from '@/features/pipeline/pipeline'
import { createImageLayerStep } from '@/features/pipeline/layer-kinds'
import type { Pipeline } from '@/features/pipeline/pipeline'
import { TEST_CANVAS, pipelineOf } from '@/test/pipelines'

const A = createImageLayerStep('source-a')
const B = createSharpStep('blur', { sigma: 2 })
const C = createSharpStep('flop')
const D = createImageLayerStep('source-d')

function grouped(enabled = true): { pipeline: Pipeline; group: string } {
  const group = createGroupStep([B, C])
  return {
    pipeline: pipelineOf(A, { ...group, enabled }, D),
    group: group.id,
  }
}

/** A pipeline as stored data, which may break the rules the schema checks. */
function rawPipeline(...steps: ReadonlyArray<unknown>): unknown {
  return { canvas: TEST_CANVAS, steps }
}

/** A group holding `step`, whatever it is, as stored data. */
function holding(step: unknown): unknown {
  return { ...createGroupStep([]), steps: [step] }
}

/** Containers nested `levels` deep, the innermost holding `inner`. */
function nested(
  levels: number,
  make: (steps: PipelineStep[]) => PipelineStep,
  inner: PipelineStep = createSharpStep('flop'),
): PipelineStep {
  let step = inner
  for (let level = 0; level < levels; level += 1) step = make([step])
  return step
}

describe('a group', () => {
  it('holds steps of its own, with a name and a switch, and no placement', () => {
    const group = createGroupStep([B, C], 'Logo')

    expect(GroupStepSchema.parse(group)).toEqual({
      id: group.id,
      kind: PipelineStepKind.Group,
      name: 'Logo',
      enabled: true,
      steps: [B, C],
    })
    expect(
      GroupStepSchema.safeParse({ ...group, ...DEFAULT_LAYER_SETTINGS })
        .success,
    ).toBe(false)
  })

  it('can be empty', () => {
    expect(
      PipelineSchema.safeParse(pipelineOf(createGroupStep([]))).success,
    ).toBe(true)
  })

  it('holds groups, which hold groups', () => {
    const inner = createGroupStep([B])
    const outer = createGroupStep([A, createGroupStep([inner])])

    expect(PipelineSchema.safeParse(pipelineOf(outer)).success).toBe(true)
  })

  it('never holds an embedded document layer, at any depth', () => {
    const embedded = createEmbeddedDocumentStep([B])

    expect(
      PipelineSchema.safeParse(rawPipeline(holding(embedded))).success,
    ).toBe(false)
    expect(
      PipelineSchema.safeParse(
        rawPipeline(createGroupStep([]), holding(holding(embedded))),
      ).success,
    ).toBe(false)
  })

  it('cannot reuse a step id, at any depth', () => {
    const twice = pipelineOf(B, createGroupStep([createGroupStep([B])]))

    expect(PipelineSchema.safeParse(twice).success).toBe(false)
  })

  it('cannot hold more steps than the limit', () => {
    const many = Array.from({ length: MAX_GROUP_STEPS + 1 }, () =>
      createSharpStep('flop'),
    )

    expect(
      PipelineSchema.safeParse(pipelineOf(createGroupStep(many))).success,
    ).toBe(false)
  })

  it('counts the steps at every depth towards the limit for a pipeline', () => {
    const groups = Array.from(
      { length: Math.ceil((MAX_PIPELINE_STEPS + 1) / MAX_GROUP_STEPS) },
      () =>
        createGroupStep([
          createGroupStep(
            Array.from({ length: MAX_GROUP_STEPS - 1 }, () =>
              createSharpStep('flop'),
            ),
          ),
        ]),
    )

    expect(PipelineSchema.safeParse(pipelineOf(...groups)).success).toBe(false)
  })
})

describe('an embedded document layer', () => {
  const inner = createImageLayerStep('logo')

  it('holds steps and is placed with the layer settings', () => {
    const embedded = createEmbeddedDocumentStep([inner, B], 'Logo')

    expect(EmbeddedDocumentStepSchema.parse(embedded)).toEqual({
      id: embedded.id,
      kind: PipelineStepKind.EmbeddedDocument,
      name: 'Logo',
      enabled: true,
      ...DEFAULT_LAYER_SETTINGS,
      steps: [inner, B],
    })
  })

  it('refuses placement settings that are out of range', () => {
    const embedded = createEmbeddedDocumentStep([B])
    expect(
      EmbeddedDocumentStepSchema.safeParse({ ...embedded, opacity: 101 })
        .success,
    ).toBe(false)
    expect(
      EmbeddedDocumentStepSchema.safeParse({ ...embedded, scale: 0 }).success,
    ).toBe(false)
  })

  it('holds groups and embedded document layers, which hold more', () => {
    const deep = createEmbeddedDocumentStep([
      createGroupStep([B]),
      createEmbeddedDocumentStep([createGroupStep([C]), inner]),
    ])

    expect(PipelineSchema.safeParse(pipelineOf(deep)).success).toBe(true)
  })

  it('stays one step for the planner while it is on, at any depth', () => {
    const innerEmbedded = createEmbeddedDocumentStep([C])
    const embedded = createEmbeddedDocumentStep([inner, B, innerEmbedded])
    const steps = planSteps(pipelineOf(A, embedded))
    expect(steps.map((step) => step.id)).toEqual([A.id, embedded.id])
  })

  it('is opened and turned off, with everything in it, while it is off', () => {
    const embedded = {
      ...createEmbeddedDocumentStep([inner, createGroupStep([B])]),
      enabled: false,
    }
    const steps = planSteps(pipelineOf(A, embedded))
    expect(steps.map((step) => step.id)).toEqual([A.id, inner.id, B.id])
    expect(steps.every((step, index) => index === 0 || !step.enabled)).toBe(
      true,
    )
  })

  it('does not hand its layer the canvas', () => {
    const embedded = createEmbeddedDocumentStep([inner])
    expect(firstImageLayer(pipelineOf(embedded, A))?.id).toBe(A.id)
    expect(firstImageLayer(pipelineOf(embedded))).toBeUndefined()
  })

  it('counts as an edit', () => {
    expect(hasEdits(pipelineOf(A, createEmbeddedDocumentStep([inner])))).toBe(
      true,
    )
  })
})

describe('nesting depth', () => {
  it('allows the limit of groups and embedded document layers, and no more', () => {
    const groups = nested(MAX_NESTING_DEPTH, (steps) =>
      createGroupStep(steps.filter(isGroupMember)),
    )
    const embedded = nested(MAX_NESTING_DEPTH, (steps) =>
      createEmbeddedDocumentStep(steps),
    )

    expect(PipelineSchema.safeParse(pipelineOf(groups)).success).toBe(true)
    expect(PipelineSchema.safeParse(pipelineOf(embedded)).success).toBe(true)
    expect(PipelineSchema.safeParse(rawPipeline(holding(groups))).success).toBe(
      false,
    )
    const tooDeep = PipelineSchema.safeParse(
      pipelineOf(createEmbeddedDocumentStep([embedded])),
    )
    expect(tooDeep.success).toBe(false)
    expect(tooDeep.error?.issues[0]?.message).toContain(
      String(MAX_NESTING_DEPTH),
    )
  })

  it('measures the deepest container of a pipeline or a step', () => {
    expect(nestingDepth([B])).toBe(0)
    expect(nestingDepth([createGroupStep([createGroupStep([B])]), C])).toBe(2)
    expect(
      nestingDepth([createEmbeddedDocumentStep([createGroupStep([])])]),
    ).toBe(2)
  })
})

describe('leafSteps, effectiveSteps and planSteps', () => {
  it('lists the steps in the order the picture is made, every container opened', () => {
    const deep = createGroupStep([B, createGroupStep([C])])
    const pipeline = pipelineOf(A, deep, createEmbeddedDocumentStep([D]))

    expect(leafSteps(pipeline).map((step) => step.id)).toEqual([
      A.id,
      B.id,
      C.id,
      D.id,
    ])
  })

  it('keeps the step’s own switch in leafSteps', () => {
    const { pipeline } = grouped(false)

    expect(leafSteps(pipeline).every((step) => step.enabled)).toBe(true)
  })

  it('turns off every step under a container that is off, in effectiveSteps', () => {
    const inner = { ...createGroupStep([C]), enabled: false }
    const pipeline = pipelineOf(A, createGroupStep([B, inner]))

    expect(effectiveSteps(pipeline).map((step) => step.enabled)).toEqual([
      true,
      true,
      false,
    ])
  })

  it('opens groups at every depth in planSteps, and turns off those under one that is off', () => {
    const inner = { ...createGroupStep([C]), enabled: false }
    const pipeline = pipelineOf(A, createGroupStep([B, inner]), D)

    expect(planSteps(pipeline).map((step) => [step.id, step.enabled])).toEqual([
      [A.id, true],
      [B.id, true],
      [C.id, false],
      [D.id, true],
    ])
  })

  it('gives the same list as the pipeline had before it was grouped', () => {
    const flat: Pipeline = pipelineOf(A, B, C, D)
    const pipeline = pipelineOf(
      A,
      createGroupStep([createGroupStep([B]), C]),
      D,
    )

    expect(planSteps(pipeline)).toEqual(planSteps(flat))
  })
})

describe('the canvas and edits with groups', () => {
  it('is the first layer that is on, even inside nested groups', () => {
    const inside = createImageLayerStep('inside')
    const pipeline: Pipeline = pipelineOf(
      createGroupStep([createGroupStep([inside])]),
      A,
    )

    expect(firstImageLayer(pipeline)?.id).toBe(inside.id)
  })

  it('skips a layer inside a group that is off', () => {
    const inside = createImageLayerStep('inside')
    const group = { ...createGroupStep([inside]), enabled: false }

    expect(firstImageLayer(pipelineOf(createGroupStep([group]), A))?.id).toBe(
      A.id,
    )
  })

  it('has edits when a group holds a step that is not a layer', () => {
    const { pipeline } = grouped()

    expect(hasEdits(pipeline)).toBe(true)
    expect(hasEdits(pipelineOf(createGroupStep([A])))).toBe(false)
  })
})

describe('finding a step', () => {
  const inner = createGroupStep([C])
  const embedded = createEmbeddedDocumentStep([B, inner])
  const pipeline = pipelineOf(A, embedded, D)

  it('says which list a step is in and its place, at any depth', () => {
    expect(findStep(pipeline, A.id)).toMatchObject({ index: 0 })
    expect(findStep(pipeline, A.id)?.parentId).toBeUndefined()
    expect(findStep(pipeline, B.id)).toMatchObject({
      index: 0,
      parentId: embedded.id,
    })
    expect(findStep(pipeline, C.id)).toMatchObject({
      index: 0,
      parentId: inner.id,
    })
    expect(findStep(pipeline, 'missing')).toBeUndefined()
  })

  it('lists the containers a step is in, outermost first', () => {
    expect(stepAncestors(pipeline, C.id)?.map(({ id }) => id)).toEqual([
      embedded.id,
      inner.id,
    ])
    expect(stepAncestors(pipeline, A.id)).toEqual([])
    expect(stepAncestors(pipeline, 'missing')).toBeUndefined()
  })

  it('gives the steps of a list: the top, or a container’s', () => {
    expect(childSteps(pipeline)?.map(({ id }) => id)).toEqual([
      A.id,
      embedded.id,
      D.id,
    ])
    expect(childSteps(pipeline, inner.id)?.map(({ id }) => id)).toEqual([C.id])
    expect(childSteps(pipeline, A.id)).toBeUndefined()
    expect(childSteps(pipeline, 'missing')).toBeUndefined()
  })

  it('tells a container from a step that does work', () => {
    expect(isContainerStep(inner)).toBe(true)
    expect(isContainerStep(embedded)).toBe(true)
    expect(isContainerStep(B)).toBe(false)
  })
})

describe('editing a pipeline with nested containers', () => {
  const inner = createGroupStep([C])
  const outer = createGroupStep([B, inner])
  const pipeline = pipelineOf(A, outer, D)

  it('inserts into a container at any depth, at a place', () => {
    const added = createSharpStep('negate')

    const next = insertStep(pipeline, added, 0, inner.id)

    expect(findStep(next, added.id)).toMatchObject({
      parentId: inner.id,
      index: 0,
    })
    expect(leafSteps(next).map((step) => step.id)).toEqual([
      A.id,
      B.id,
      added.id,
      C.id,
      D.id,
    ])
  })

  it('leaves the pipeline as it was for a container that is not there', () => {
    expect(insertStep(pipeline, createSharpStep('negate'), 0, 'nope')).toEqual(
      pipeline,
    )
  })

  it('removes a step at any depth, or a container with everything in it', () => {
    expect(findStep(removeStep(pipeline, C.id), C.id)).toBeUndefined()
    expect(removeStep(pipeline, outer.id).steps.map((s) => s.id)).toEqual([
      A.id,
      D.id,
    ])
  })

  it('moves a step between levels', () => {
    const out = moveStep(pipeline, C.id, 0)
    expect(out.steps.map((s) => s.id).slice(0, 2)).toEqual([C.id, A.id])

    const back = moveStep(out, C.id, 0, inner.id)
    expect(findStep(back, C.id)).toMatchObject({ parentId: inner.id, index: 0 })

    const deeper = moveStep(pipeline, D.id, 1, inner.id)
    expect(findStep(deeper, D.id)).toMatchObject({
      parentId: inner.id,
      index: 1,
    })
  })

  it('replaces and switches a step or a container at any depth', () => {
    const renamed = replaceStep(pipeline, { ...C, name: 'Mirror' })
    expect(findStep(renamed, C.id)?.step).toMatchObject({ name: 'Mirror' })

    const off = setStepEnabled(pipeline, inner.id, false)
    expect(findStep(off, inner.id)?.step.enabled).toBe(false)
    expect(leafSteps(off).every((step) => step.enabled)).toBe(true)
  })
})

describe('copyStep', () => {
  it('gives a leaf step an id of its own and keeps the rest', () => {
    const copy = copyStep(B)
    expect(copy.id).not.toBe(B.id)
    expect({ ...copy, id: B.id }).toEqual(B)
  })

  it('gives a container and every step in it new ids, at any depth', () => {
    const inner = createGroupStep([C])
    const embedded = {
      ...createEmbeddedDocumentStep([B, inner], 'Look'),
      enabled: false,
    }
    const copy = copyStep(embedded)
    if (copy.kind !== PipelineStepKind.EmbeddedDocument) {
      throw new Error('expected an embedded document layer')
    }
    expect(copy.name).toBe('Look')
    expect(copy.enabled).toBe(false)
    const before = [embedded, B, inner, C].map(({ id }) => id)
    const after = [copy.id, ...leafAndContainerIds(copy.steps)]
    expect(after).toHaveLength(4)
    expect(new Set([...before, ...after]).size).toBe(8)
  })
})

function leafAndContainerIds(steps: ReadonlyArray<PipelineStep>): string[] {
  return steps.flatMap((step) =>
    isContainerStep(step)
      ? [step.id, ...leafAndContainerIds(step.steps)]
      : [step.id],
  )
}

describe('groupableSteps', () => {
  const pipeline: Pipeline = pipelineOf(A, B, C, D)

  it('returns steps that are next to each other in one list, in order, with the list', () => {
    expect(groupableSteps(pipeline, [C.id, B.id])).toEqual({
      steps: [B, C],
      parentId: undefined,
    })
    const { pipeline: withGroup, group } = grouped()
    expect(groupableSteps(withGroup, [C.id, B.id])).toEqual({
      steps: [B, C],
      parentId: group,
    })
  })

  it('groups a group, which then holds it', () => {
    const { pipeline: withGroup, group } = grouped()
    const found = groupableSteps(withGroup, [group, D.id])
    expect(found?.steps.map(({ id }) => id)).toEqual([group, D.id])
  })

  it('refuses none, a gap, an unknown id, steps in two lists and an embedded document layer', () => {
    expect(groupableSteps(pipeline, [])).toBeUndefined()
    expect(groupableSteps(pipeline, [A.id, C.id])).toBeUndefined()
    expect(groupableSteps(pipeline, [A.id, 'nope'])).toBeUndefined()
    const { pipeline: withGroup } = grouped()
    expect(groupableSteps(withGroup, [A.id, B.id])).toBeUndefined()
    const embedded = createEmbeddedDocumentStep([B])
    expect(
      groupableSteps(pipelineOf(A, embedded), [A.id, embedded.id]),
    ).toBeUndefined()
  })
})

describe('placementProblem', () => {
  const inner = createGroupStep([C])
  const group = createGroupStep([B, inner])
  const embedded = createEmbeddedDocumentStep([])
  const pipeline = pipelineOf(A, group, embedded)

  it('allows a step anywhere a container can hold it', () => {
    expect(placementProblem(pipeline, D, undefined)).toBeUndefined()
    expect(placementProblem(pipeline, D, inner.id)).toBeUndefined()
    expect(placementProblem(pipeline, group, embedded.id)).toBeUndefined()
  })

  it('refuses a list that is not a container, itself, and inside itself', () => {
    expect(placementProblem(pipeline, D, A.id)).toMatch(/no longer/)
    expect(placementProblem(pipeline, group, group.id)).toBe(
      'A step cannot go inside itself.',
    )
    expect(placementProblem(pipeline, group, inner.id)).toBe(
      'A step cannot go inside itself.',
    )
  })

  it('refuses an embedded document layer in a group, however deep it is held', () => {
    expect(placementProblem(pipeline, embedded, group.id)).toBe(
      'A group cannot hold an embedded document layer.',
    )
    const holding = { ...createGroupStep([]), steps: [] }
    expect(placementProblem(pipeline, holding, inner.id)).toBeUndefined()
  })

  it('refuses going deeper than the limit', () => {
    let deep: PipelineStep = createGroupStep([])
    for (let level = 1; level < MAX_NESTING_DEPTH - 1; level += 1) {
      deep = createGroupStep([deep as never])
    }
    expect(placementProblem(pipeline, deep, group.id)).toBeUndefined()
    expect(placementProblem(pipeline, deep, inner.id)).toMatch(
      String(MAX_NESTING_DEPTH),
    )
  })
})

describe('placeAfter', () => {
  const inner = createGroupStep([C])
  const group = createGroupStep([B, inner])
  const pipeline = pipelineOf(A, group, D)

  it('is the end of the pipeline when there is no step to go after', () => {
    expect(placeAfter(pipeline, createSharpStep('flip'), undefined)).toEqual({
      index: 3,
    })
    expect(placeAfter(pipeline, createSharpStep('flip'), 'nope')).toEqual({
      index: 3,
    })
  })

  it('is just after the step, in its own list', () => {
    expect(placeAfter(pipeline, createSharpStep('flip'), C.id)).toEqual({
      index: 1,
      parentId: inner.id,
    })
    expect(placeAfter(pipeline, createSharpStep('flip'), group.id)).toEqual({
      index: 2,
    })
  })

  it('goes into a container at its end when asked', () => {
    expect(
      placeAfter(pipeline, createSharpStep('flip'), inner.id, { into: true }),
    ).toEqual({ index: 1, parentId: inner.id })
  })

  it('goes after the nearest container that can hold the step', () => {
    const embedded = createEmbeddedDocumentStep([])
    expect(placeAfter(pipeline, embedded, C.id)).toEqual({ index: 2 })
    expect(placeAfter(pipeline, embedded, inner.id, { into: true })).toEqual({
      index: 2,
    })
  })
})
