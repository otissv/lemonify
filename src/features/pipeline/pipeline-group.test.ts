import { describe, expect, it } from 'vitest'

import { DEFAULT_LAYER_SETTINGS } from '@/features/pipeline/layer'
import {
  GroupStepSchema,
  MAX_GROUP_STEPS,
  MAX_PIPELINE_STEPS,
  PipelineSchema,
  PipelineStepKind,
  canvasLayer,
  copyStep,
  createGroupStep,
  createLayerStep,
  createSharpStep,
  planSteps,
  findStep,
  groupableSteps,
  hasEdits,
  insertStep,
  leafSteps,
  moveStep,
  removeStep,
  replaceStep,
  setStepEnabled,
} from '@/features/pipeline/pipeline'
import type { Pipeline } from '@/features/pipeline/pipeline'

const A = createLayerStep('source-a')
const B = createSharpStep('blur', { sigma: 2 })
const C = createSharpStep('flop')
const D = createLayerStep('source-d')

function grouped(enabled = true): { pipeline: Pipeline; group: string } {
  const group = createGroupStep([B, C])
  return {
    pipeline: { steps: [A, { ...group, enabled }, D] },
    group: group.id,
  }
}

describe('a group', () => {
  it('holds steps of its own, with a name and a switch', () => {
    const group = createGroupStep([B, C], 'Logo')

    expect(GroupStepSchema.parse(group)).toEqual({
      id: group.id,
      kind: PipelineStepKind.Group,
      name: 'Logo',
      enabled: true,
      subDocument: false,
      ...DEFAULT_LAYER_SETTINGS,
      steps: [B, C],
    })
  })

  it('can be empty', () => {
    expect(
      PipelineSchema.safeParse({ steps: [createGroupStep([])] }).success,
    ).toBe(true)
  })

  it('cannot hold another group', () => {
    const nested = { ...createGroupStep([]), steps: [createGroupStep([B])] }

    expect(PipelineSchema.safeParse({ steps: [nested] }).success).toBe(false)
  })

  it('cannot reuse a step id, inside a group or across the pipeline', () => {
    const twice = { steps: [B, createGroupStep([B])] }

    const result = PipelineSchema.safeParse(twice)

    expect(result.success).toBe(false)
  })

  it('cannot hold more steps than the limit', () => {
    const many = Array.from({ length: MAX_GROUP_STEPS + 1 }, () =>
      createSharpStep('flop'),
    )

    expect(
      PipelineSchema.safeParse({ steps: [createGroupStep(many)] }).success,
    ).toBe(false)
  })

  it('counts the steps inside groups towards the limit for a pipeline', () => {
    const groups = Array.from(
      { length: Math.ceil((MAX_PIPELINE_STEPS + 1) / MAX_GROUP_STEPS) },
      () =>
        createGroupStep(
          Array.from({ length: MAX_GROUP_STEPS }, () =>
            createSharpStep('flop'),
          ),
        ),
    )

    expect(PipelineSchema.safeParse({ steps: groups }).success).toBe(false)
  })
})

describe('leafSteps and planSteps', () => {
  it('lists the steps in the order the picture is made, groups opened', () => {
    const { pipeline } = grouped()

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

  it('turns off every step of a group that is off, in planSteps', () => {
    const { pipeline } = grouped(false)

    expect(planSteps(pipeline).map((step) => step.enabled)).toEqual([
      true,
      false,
      false,
      true,
    ])
  })

  it('gives the same list as the pipeline had before it was grouped', () => {
    const flat: Pipeline = { steps: [A, B, C, D] }
    const { pipeline } = grouped()

    expect(planSteps(pipeline)).toEqual(planSteps(flat))
  })
})

describe('the canvas and edits with groups', () => {
  it('is the first layer that is on, even inside a group', () => {
    const inside = createLayerStep('inside')
    const pipeline: Pipeline = {
      steps: [createGroupStep([inside]), A],
    }

    expect(canvasLayer(pipeline)?.id).toBe(inside.id)
  })

  it('skips a layer inside a group that is off', () => {
    const inside = createLayerStep('inside')
    const group = { ...createGroupStep([inside]), enabled: false }

    expect(canvasLayer({ steps: [group, A] })?.id).toBe(A.id)
  })

  it('has edits when a group holds a step that is not the canvas layer', () => {
    const { pipeline } = grouped()

    expect(hasEdits(pipeline)).toBe(true)
    expect(hasEdits({ steps: [createGroupStep([A])] })).toBe(false)
  })
})

describe('finding a step', () => {
  it('says where a step is: top level or inside a group, and its place', () => {
    const { pipeline, group } = grouped()

    expect(findStep(pipeline, A.id)).toMatchObject({ index: 0 })
    expect(findStep(pipeline, A.id)?.groupId).toBeUndefined()
    expect(findStep(pipeline, C.id)).toMatchObject({ index: 1, groupId: group })
    expect(findStep(pipeline, group)?.step.kind).toBe(PipelineStepKind.Group)
    expect(findStep(pipeline, 'missing')).toBeUndefined()
  })
})

describe('editing a pipeline with groups', () => {
  it('inserts into a group at a place', () => {
    const { pipeline, group } = grouped()
    const added = createSharpStep('negate')

    const next = insertStep(pipeline, added, 1, group)

    expect(leafSteps(next).map((step) => step.id)).toEqual([
      A.id,
      B.id,
      added.id,
      C.id,
      D.id,
    ])
    expect(findStep(next, added.id)?.groupId).toBe(group)
  })

  it('removes a step from a group, or a whole group', () => {
    const { pipeline, group } = grouped()

    expect(leafSteps(removeStep(pipeline, B.id)).map((s) => s.id)).toEqual([
      A.id,
      C.id,
      D.id,
    ])
    expect(removeStep(pipeline, group).steps.map((s) => s.id)).toEqual([
      A.id,
      D.id,
    ])
  })

  it('moves a step out of a group to the top level, and into one', () => {
    const { pipeline, group } = grouped()

    const out = moveStep(pipeline, B.id, 0)
    expect(out.steps.map((s) => s.id).slice(0, 2)).toEqual([B.id, A.id])
    expect(findStep(out, B.id)?.groupId).toBeUndefined()

    const back = moveStep(out, B.id, 0, group)
    expect(findStep(back, B.id)).toMatchObject({ groupId: group, index: 0 })
  })

  it('replaces and switches a step inside a group', () => {
    const { pipeline } = grouped()

    const renamed = replaceStep(pipeline, { ...B, name: 'Soften' })
    expect(findStep(renamed, B.id)?.step).toMatchObject({ name: 'Soften' })

    const off = setStepEnabled(pipeline, C.id, false)
    expect(findStep(off, C.id)?.step.enabled).toBe(false)
  })

  it('switches a group, which leaves its steps’ own switches alone', () => {
    const { pipeline, group } = grouped()

    const off = setStepEnabled(pipeline, group, false)

    expect(findStep(off, group)?.step.enabled).toBe(false)
    expect(leafSteps(off).every((step) => step.enabled)).toBe(true)
  })
})

describe('copyStep', () => {
  it('gives a leaf step an id of its own and keeps the rest', () => {
    const copy = copyStep(B)
    expect(copy.id).not.toBe(B.id)
    expect({ ...copy, id: B.id }).toEqual(B)
  })

  it('gives a group and each step in it new ids, keeping order, name and switches', () => {
    const group = { ...createGroupStep([B, C], 'Look'), enabled: false }
    const copy = copyStep(group)
    if (copy.kind !== PipelineStepKind.Group) throw new Error('expected group')
    expect(copy.id).not.toBe(group.id)
    expect(copy.name).toBe('Look')
    expect(copy.enabled).toBe(false)
    expect(copy.steps).toMatchObject([{ op: 'blur' }, { op: 'flop' }])
    const ids = new Set([
      group.id,
      B.id,
      C.id,
      copy.id,
      ...copy.steps.map(({ id }) => id),
    ])
    expect(ids.size).toBe(6)
  })
})

describe('groupableSteps', () => {
  const pipeline: Pipeline = { steps: [A, B, C, D] }

  it('returns steps that are next to each other, in pipeline order', () => {
    expect(groupableSteps(pipeline, [C.id, B.id])).toEqual([B, C])
    expect(groupableSteps(pipeline, [A.id])).toEqual([A])
  })

  it('refuses none, a gap, an unknown id, a group and a step inside a group', () => {
    expect(groupableSteps(pipeline, [])).toBeUndefined()
    expect(groupableSteps(pipeline, [A.id, C.id])).toBeUndefined()
    expect(groupableSteps(pipeline, [A.id, 'nope'])).toBeUndefined()
    const { pipeline: withGroup, group } = grouped()
    expect(groupableSteps(withGroup, [group])).toBeUndefined()
    expect(groupableSteps(withGroup, [B.id])).toBeUndefined()
  })
})

describe('a sub-document', () => {
  const inner = createLayerStep('logo')
  const sub = (enabled = true) => ({
    ...createGroupStep([inner, B], 'Logo'),
    subDocument: true,
    enabled,
  })

  it('reads a group written without the setting as a plain group, with the default placement', () => {
    const { id, kind, steps } = createGroupStep([B])
    const parsed = GroupStepSchema.parse({ id, kind, steps })
    expect(parsed).toMatchObject({
      enabled: true,
      subDocument: false,
      ...DEFAULT_LAYER_SETTINGS,
    })
  })

  it('refuses placement settings that are out of range', () => {
    const group = createGroupStep([B])
    expect(GroupStepSchema.safeParse({ ...group, opacity: 101 }).success).toBe(
      false,
    )
    expect(GroupStepSchema.safeParse({ ...group, scale: 0 }).success).toBe(
      false,
    )
  })

  it('stays one step for the planner while it is on', () => {
    const group = sub()
    const steps = planSteps({ steps: [A, group, C] })
    expect(steps.map((step) => step.id)).toEqual([A.id, group.id, C.id])
  })

  it('is opened and turned off, like any group, while it is off', () => {
    const group = sub(false)
    const steps = planSteps({ steps: [A, group] })
    expect(steps.map((step) => step.id)).toEqual([A.id, inner.id, B.id])
    expect(steps.every((step, index) => index === 0 || !step.enabled)).toBe(
      true,
    )
  })

  it('does not hand its layer the canvas', () => {
    expect(canvasLayer({ steps: [sub(), A] })?.id).toBe(A.id)
    expect(canvasLayer({ steps: [sub()] })).toBeUndefined()
  })

  it('still counts as an edit', () => {
    expect(hasEdits({ steps: [A, sub()] })).toBe(true)
  })

  it('has its images and steps found like those of any group', () => {
    const group = sub()
    const pipeline: Pipeline = { steps: [A, group] }
    expect(leafSteps(pipeline).map((step) => step.id)).toEqual([
      A.id,
      inner.id,
      B.id,
    ])
    expect(findStep(pipeline, B.id)?.groupId).toBe(group.id)
  })
})
