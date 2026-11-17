import { describe, expect, it } from 'vitest'

import {
  DocumentChangeSchema,
  HistoryPatchSchema,
  InvalidChangeError,
  applyChange,
  planChange,
} from '@/features/pipeline/document-change'
import type { DocumentChange } from '@/features/pipeline/document-change'
import {
  MAX_GROUP_STEPS,
  createGroupStep,
  createSharpStep,
  findStep,
  leafSteps,
} from '@/features/pipeline/pipeline'
import { createImageLayerStep } from '@/features/pipeline/layer-kinds'
import type { Pipeline } from '@/features/pipeline/pipeline'
import { DEFAULT_LAYER_SETTINGS } from '@/features/pipeline/layer'
import { pipelineOf } from '@/test/pipelines'

const A = createImageLayerStep('source-a')
const B = createSharpStep('blur', { sigma: 2 })
const C = createSharpStep('flop')
const D = createSharpStep('negate')

const FLAT: Pipeline = pipelineOf(A, B, C, D)

/** Applies a change, then its inverse, and expects the original back; then redo. */
function roundTrip(pipeline: Pipeline, change: DocumentChange): Pipeline {
  const planned = planChange(pipeline, change)
  if (planned === null) throw new Error('expected a change')
  expect(applyChange(planned.pipeline, planned.patch.inverse)).toEqual(pipeline)
  expect(applyChange(pipeline, planned.patch.forward)).toEqual(planned.pipeline)
  expect(HistoryPatchSchema.safeParse(planned.patch).success).toBe(true)
  return planned.pipeline
}

function ids(pipeline: Pipeline): string[] {
  return pipeline.steps.map((step) => step.id)
}

describe('grouping steps', () => {
  it('wraps a run of steps in a group, where the first of them was', () => {
    const group = createGroupStep([B, C], 'Soften')

    const next = roundTrip(FLAT, { type: 'group-steps', group })

    expect(ids(next)).toEqual([A.id, group.id, D.id])
    expect(findStep(next, B.id)?.groupId).toBe(group.id)
  })

  it('does not change the order the picture is made in', () => {
    const group = createGroupStep([B, C])

    const next = applyChange(FLAT, { type: 'group-steps', group })

    expect(leafSteps(next).map((step) => step.id)).toEqual(
      leafSteps(FLAT).map((step) => step.id),
    )
  })

  it('refuses steps that are not next to each other', () => {
    const group = createGroupStep([B, D])

    expect(() => applyChange(FLAT, { type: 'group-steps', group })).toThrow(
      'next to each other',
    )
  })

  it('refuses steps given in another order than the pipeline has them', () => {
    const group = createGroupStep([C, B])

    expect(() => applyChange(FLAT, { type: 'group-steps', group })).toThrow(
      InvalidChangeError,
    )
  })

  it('refuses a step that is not there, or is already in a group', () => {
    const inside = createGroupStep([B])
    const pipeline: Pipeline = pipelineOf(A, inside, C)

    expect(() =>
      applyChange(FLAT, {
        type: 'group-steps',
        group: createGroupStep([createSharpStep('flip')]),
      }),
    ).toThrow(InvalidChangeError)
    expect(() =>
      applyChange(pipeline, {
        type: 'group-steps',
        group: createGroupStep([B]),
      }),
    ).toThrow(InvalidChangeError)
  })

  it('refuses an empty group made from steps, and a group that is already there', () => {
    const existing = createGroupStep([B])
    const pipeline: Pipeline = pipelineOf(A, existing, C)

    expect(() =>
      applyChange(FLAT, { type: 'group-steps', group: createGroupStep([]) }),
    ).toThrow(InvalidChangeError)
    expect(() =>
      applyChange(pipeline, {
        type: 'group-steps',
        group: { ...createGroupStep([C]), id: existing.id },
      }),
    ).toThrow(InvalidChangeError)
  })

  it('groups the steps of one group’s neighbours, but never a group', () => {
    const inner = createGroupStep([B])
    const pipeline: Pipeline = pipelineOf(A, inner, C)

    expect(() =>
      applyChange(pipeline, {
        type: 'group-steps',
        group: createGroupStep([A, inner as never]),
      }),
    ).toThrow()
  })
})

describe('ungrouping', () => {
  const group = createGroupStep([B, C], 'Soften')
  const grouped: Pipeline = pipelineOf(A, group, D)

  it('puts the steps back in the place of the group, and undo brings it back as it was', () => {
    const next = roundTrip(grouped, { type: 'ungroup', groupId: group.id })

    expect(ids(next)).toEqual([A.id, B.id, C.id, D.id])
  })

  it('brings back a group that was switched off, with its steps’ own switches', () => {
    const off: Pipeline = pipelineOf(A, { ...group, enabled: false }, D)

    const next = roundTrip(off, { type: 'ungroup', groupId: group.id })

    expect(next.steps.every((step) => step.enabled)).toBe(true)
  })

  it('refuses a step that is not a group', () => {
    expect(() =>
      applyChange(grouped, { type: 'ungroup', groupId: A.id }),
    ).toThrow(InvalidChangeError)
    expect(() =>
      applyChange(grouped, { type: 'ungroup', groupId: 'missing' }),
    ).toThrow(InvalidChangeError)
  })
})

describe('adding to a group', () => {
  const group = createGroupStep([B])
  const grouped: Pipeline = pipelineOf(A, group, D)

  it('adds a step inside a group, and undo takes it out', () => {
    const added = createSharpStep('flip')

    const next = roundTrip(grouped, {
      type: 'add-step',
      step: added,
      index: 0,
      groupId: group.id,
    })

    expect(findStep(next, added.id)).toMatchObject({
      groupId: group.id,
      index: 0,
    })
  })

  it('adds a group at the top', () => {
    const fresh = createGroupStep([createSharpStep('flip')])

    const next = roundTrip(grouped, { type: 'add-step', step: fresh, index: 1 })

    expect(ids(next)).toEqual([A.id, fresh.id, group.id, D.id])
  })

  it('refuses a group inside a group, and a group that is not there', () => {
    expect(() =>
      applyChange(grouped, {
        type: 'add-step',
        step: createGroupStep([]),
        index: 0,
        groupId: group.id,
      }),
    ).toThrow('inside another group')
    expect(() =>
      applyChange(grouped, {
        type: 'add-step',
        step: createSharpStep('flip'),
        index: 0,
        groupId: 'missing',
      }),
    ).toThrow(InvalidChangeError)
    expect(() =>
      applyChange(grouped, {
        type: 'add-step',
        step: createSharpStep('flip'),
        index: 0,
        groupId: A.id,
      }),
    ).toThrow(InvalidChangeError)
  })

  it('refuses a group that would hold too many steps', () => {
    const full = createGroupStep(
      Array.from({ length: MAX_GROUP_STEPS }, () => createSharpStep('flop')),
    )

    expect(() =>
      applyChange(pipelineOf(full), {
        type: 'add-step',
        step: createSharpStep('flip'),
        index: 0,
        groupId: full.id,
      }),
    ).toThrow(InvalidChangeError)
  })
})

describe('moving between a group and the top', () => {
  const group = createGroupStep([B, C])
  const grouped: Pipeline = pipelineOf(A, group, D)

  it('moves a step out of a group, and undo puts it back in its place', () => {
    const next = roundTrip(grouped, { type: 'move-step', stepId: B.id, to: 0 })

    expect(ids(next)).toEqual([B.id, A.id, group.id, D.id])
  })

  it('moves a step into a group, and undo takes it out to where it was', () => {
    const next = roundTrip(grouped, {
      type: 'move-step',
      stepId: D.id,
      to: 1,
      groupId: group.id,
    })

    expect(findStep(next, D.id)).toMatchObject({ groupId: group.id, index: 1 })
  })

  it('moves a step within its group', () => {
    const next = roundTrip(grouped, {
      type: 'move-step',
      stepId: C.id,
      to: 0,
      groupId: group.id,
    })

    expect(findStep(next, C.id)?.index).toBe(0)
  })

  it('moves a whole group at the top', () => {
    const next = roundTrip(grouped, {
      type: 'move-step',
      stepId: group.id,
      to: 0,
    })

    expect(ids(next)).toEqual([group.id, A.id, D.id])
  })

  it('refuses a group moved into a group, and a step moved into something that is not a group', () => {
    expect(() =>
      applyChange(grouped, {
        type: 'move-step',
        stepId: group.id,
        to: 0,
        groupId: group.id,
      }),
    ).toThrow('inside another group')
    expect(() =>
      applyChange(grouped, {
        type: 'move-step',
        stepId: D.id,
        to: 0,
        groupId: A.id,
      }),
    ).toThrow(InvalidChangeError)
  })
})

describe('other edits with groups', () => {
  const group = createGroupStep([B, C], 'Soften')
  const grouped: Pipeline = pipelineOf(A, group, D)

  it('removes a step inside a group, and undo puts it back', () => {
    const next = roundTrip(grouped, { type: 'remove-step', stepId: B.id })

    expect(findStep(next, B.id)).toBeUndefined()
  })

  it('removes a whole group with its steps, and undo brings all of it back', () => {
    const next = roundTrip(grouped, { type: 'remove-step', stepId: group.id })

    expect(ids(next)).toEqual([A.id, D.id])
  })

  it('switches a group on and off, and renames it', () => {
    const off = roundTrip(grouped, {
      type: 'set-enabled',
      stepId: group.id,
      enabled: false,
    })
    expect(findStep(off, group.id)?.step.enabled).toBe(false)

    const named = roundTrip(grouped, {
      type: 'rename-step',
      stepId: group.id,
      name: 'Logo',
    })
    expect(findStep(named, group.id)?.step).toMatchObject({ name: 'Logo' })
  })

  it('edits a step inside a group', () => {
    const next = roundTrip(grouped, {
      type: 'set-options',
      stepId: B.id,
      options: { sigma: 9 },
    })

    expect(findStep(next, B.id)?.step).toMatchObject({ options: { sigma: 9 } })
  })

  it('refuses a step edit that does not fit a group', () => {
    expect(() =>
      applyChange(grouped, {
        type: 'set-options',
        stepId: group.id,
        options: {},
      }),
    ).toThrow(InvalidChangeError)
    expect(() =>
      applyChange(grouped, {
        type: 'set-image',
        stepId: group.id,
        sourceId: 'x',
      }),
    ).toThrow(InvalidChangeError)
  })
})

describe('the change schema with groups', () => {
  it('reads the new changes and the group place on the old ones', () => {
    const group = createGroupStep([B])
    for (const change of [
      { type: 'group-steps', group },
      { type: 'ungroup', groupId: group.id },
      { type: 'add-step', step: C, index: 0, groupId: group.id },
      { type: 'move-step', stepId: C.id, to: 0, groupId: group.id },
    ]) {
      expect(DocumentChangeSchema.safeParse(change).success).toBe(true)
    }
  })

  it('refuses a group in a group', () => {
    const nested = { ...createGroupStep([]), steps: [createGroupStep([B])] }

    expect(
      DocumentChangeSchema.safeParse({ type: 'group-steps', group: nested })
        .success,
    ).toBe(false)
  })
})

describe('a group as a sub-document', () => {
  const group = createGroupStep([B, C], 'Logo')
  const base: Pipeline = pipelineOf(A, group, D)

  it('is switched on and off, undoing back to how it was', () => {
    const on = roundTrip(base, {
      type: 'set-sub-document',
      stepId: group.id,
      subDocument: true,
    })
    expect(findStep(on, group.id)?.step).toMatchObject({ subDocument: true })

    const off = roundTrip(on, {
      type: 'set-sub-document',
      stepId: group.id,
      subDocument: false,
    })
    expect(off).toEqual(base)
  })

  it('does nothing when it already is that', () => {
    expect(
      planChange(base, {
        type: 'set-sub-document',
        stepId: group.id,
        subDocument: false,
      }),
    ).toBeNull()
  })

  it('is only for groups', () => {
    expect(() =>
      applyChange(base, {
        type: 'set-sub-document',
        stepId: B.id,
        subDocument: true,
      }),
    ).toThrow(InvalidChangeError)
    expect(() =>
      applyChange(base, {
        type: 'set-sub-document',
        stepId: 'nope',
        subDocument: true,
      }),
    ).toThrow(InvalidChangeError)
  })

  it('is placed with the layer settings, undoing back to the old ones', () => {
    const settings = { ...DEFAULT_LAYER_SETTINGS, opacity: 40, x: 12 }

    const next = roundTrip(base, {
      type: 'set-layer',
      stepId: group.id,
      settings,
    })

    expect(findStep(next, group.id)?.step).toMatchObject(settings)
  })

  it('still refuses options and an image, which a group does not have', () => {
    expect(() =>
      applyChange(base, {
        type: 'set-image',
        stepId: group.id,
        sourceId: 'x',
      }),
    ).toThrow(InvalidChangeError)
    expect(() =>
      applyChange(base, { type: 'set-options', stepId: group.id, options: {} }),
    ).toThrow(InvalidChangeError)
  })

  it('is kept whole when grouping is undone and redone', () => {
    const placed = {
      ...group,
      subDocument: true,
      opacity: 30,
      steps: group.steps,
    }
    const next = roundTrip(pipelineOf(A, B, C, D), {
      type: 'group-steps',
      group: placed,
    })
    const undone = roundTrip(next, { type: 'ungroup', groupId: placed.id })
    expect(undone.steps).toHaveLength(4)
  })
})
