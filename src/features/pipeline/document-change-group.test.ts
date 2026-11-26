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
  MAX_NESTING_DEPTH,
  PipelineStepKind,
  createEmbeddedDocumentStep,
  createGroupStep,
  createSharpStep,
  findStep,
  leafSteps,
} from '@/features/pipeline/pipeline'
import type { PipelineStep } from '@/features/pipeline/pipeline'
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

function ids(pipeline: { steps: ReadonlyArray<PipelineStep> }): string[] {
  return pipeline.steps.map((step) => step.id)
}

describe('grouping steps', () => {
  it('wraps a run of steps in a group, where the first of them was', () => {
    const group = createGroupStep([B, C], 'Soften')

    const next = roundTrip(FLAT, { type: 'group-steps', group })

    expect(ids(next)).toEqual([A.id, group.id, D.id])
    expect(findStep(next, B.id)?.parentId).toBe(group.id)
  })

  it('groups steps inside a group, which then holds the new group', () => {
    const outer = createGroupStep([B, C, D])
    const pipeline = pipelineOf(A, outer)
    const inner = createGroupStep([C, D])

    const next = roundTrip(pipeline, { type: 'group-steps', group: inner })

    expect(findStep(next, inner.id)?.parentId).toBe(outer.id)
    expect(findStep(next, D.id)?.parentId).toBe(inner.id)
  })

  it('groups a group with its neighbour', () => {
    const inner = createGroupStep([B])
    const pipeline = pipelineOf(A, inner, C)
    const outer = createGroupStep([inner, C])

    const next = roundTrip(pipeline, { type: 'group-steps', group: outer })

    expect(findStep(next, inner.id)?.parentId).toBe(outer.id)
  })

  it('does not change the order the picture is made in', () => {
    const group = createGroupStep([B, C])

    const next = applyChange(FLAT, { type: 'group-steps', group })

    expect(leafSteps(next).map((step) => step.id)).toEqual(
      leafSteps(FLAT).map((step) => step.id),
    )
  })

  it('refuses steps that are not next to each other, or not in one list', () => {
    expect(() =>
      applyChange(FLAT, {
        type: 'group-steps',
        group: createGroupStep([B, D]),
      }),
    ).toThrow('next to each other')
    const inside = createGroupStep([B])
    expect(() =>
      applyChange(pipelineOf(A, inside, C), {
        type: 'group-steps',
        group: createGroupStep([B, C]),
      }),
    ).toThrow(InvalidChangeError)
  })

  it('refuses steps given in another order than the pipeline has them', () => {
    expect(() =>
      applyChange(FLAT, {
        type: 'group-steps',
        group: createGroupStep([C, B]),
      }),
    ).toThrow(InvalidChangeError)
  })

  it('refuses a step that is not there, an empty group and a group that is already there', () => {
    const existing = createGroupStep([B])
    expect(() =>
      applyChange(FLAT, {
        type: 'group-steps',
        group: createGroupStep([createSharpStep('flip')]),
      }),
    ).toThrow(InvalidChangeError)
    expect(() =>
      applyChange(FLAT, { type: 'group-steps', group: createGroupStep([]) }),
    ).toThrow(InvalidChangeError)
    expect(() =>
      applyChange(pipelineOf(A, existing, C), {
        type: 'group-steps',
        group: { ...createGroupStep([C]), id: existing.id },
      }),
    ).toThrow(InvalidChangeError)
  })

  it('refuses a group that would go deeper than the limit', () => {
    let deepest: PipelineStep = B
    for (let level = 0; level < MAX_NESTING_DEPTH; level += 1) {
      deepest = createGroupStep([deepest as never])
    }
    expect(() =>
      applyChange(pipelineOf(A), {
        type: 'add-step',
        step: deepest,
        index: 1,
      }),
    ).not.toThrow()
    const holder = createGroupStep([A])
    expect(() =>
      applyChange(pipelineOf(holder), {
        type: 'add-step',
        step: deepest,
        index: 0,
        parentId: holder.id,
      }),
    ).toThrow(String(MAX_NESTING_DEPTH))
  })
})

describe('ungrouping', () => {
  const group = createGroupStep([B, C], 'Soften')
  const grouped: Pipeline = pipelineOf(A, group, D)

  it('puts the steps back in the place of the group, and undo brings it back as it was', () => {
    const next = roundTrip(grouped, { type: 'ungroup', stepId: group.id })

    expect(ids(next)).toEqual([A.id, B.id, C.id, D.id])
  })

  it('ungroups a group inside a group into the outer one', () => {
    const outer = createGroupStep([A, group])
    const pipeline = pipelineOf(outer, D)

    const next = roundTrip(pipeline, { type: 'ungroup', stepId: group.id })

    const found = findStep(next, outer.id)?.step
    expect(found !== undefined && 'steps' in found ? ids(found) : []).toEqual([
      A.id,
      B.id,
      C.id,
    ])
  })

  it('takes the steps out of an embedded document layer, and undo puts it back with its placement', () => {
    const embedded = { ...createEmbeddedDocumentStep([B, C]), opacity: 30 }

    const next = roundTrip(pipelineOf(A, embedded, D), {
      type: 'ungroup',
      stepId: embedded.id,
    })

    expect(ids(next)).toEqual([A.id, B.id, C.id, D.id])
  })

  it('refuses taking an embedded document layer into a group', () => {
    const inner = createEmbeddedDocumentStep([B])
    const embedded = createEmbeddedDocumentStep([inner])
    const outer = createGroupStep([])
    const pipeline = pipelineOf(A, outer, embedded)
    const moved = applyChange(pipeline, {
      type: 'move-step',
      stepId: embedded.id,
      to: 0,
    })

    expect(() =>
      applyChange(moved, {
        type: 'move-step',
        stepId: inner.id,
        to: 0,
        parentId: outer.id,
      }),
    ).toThrow('A group cannot hold an embedded document layer.')
  })

  it('brings back a group that was switched off, with its steps’ own switches', () => {
    const off: Pipeline = pipelineOf(A, { ...group, enabled: false }, D)

    const next = roundTrip(off, { type: 'ungroup', stepId: group.id })

    expect(next.steps.every((step) => step.enabled)).toBe(true)
  })

  it('refuses a step that holds no steps', () => {
    expect(() =>
      applyChange(grouped, { type: 'ungroup', stepId: A.id }),
    ).toThrow(InvalidChangeError)
    expect(() =>
      applyChange(grouped, { type: 'ungroup', stepId: 'missing' }),
    ).toThrow(InvalidChangeError)
  })
})

describe('adding into a container', () => {
  const inner = createGroupStep([B])
  const group = createGroupStep([inner])
  const grouped: Pipeline = pipelineOf(A, group, D)

  it('adds a step at any depth, and undo takes it out', () => {
    const added = createSharpStep('flip')

    const next = roundTrip(grouped, {
      type: 'add-step',
      step: added,
      index: 0,
      parentId: inner.id,
    })

    expect(findStep(next, added.id)).toMatchObject({
      parentId: inner.id,
      index: 0,
    })
  })

  it('adds a group inside a group, and an embedded document layer inside an embedded one', () => {
    const fresh = createGroupStep([createSharpStep('flip')])
    const next = roundTrip(grouped, {
      type: 'add-step',
      step: fresh,
      index: 0,
      parentId: group.id,
    })
    expect(findStep(next, fresh.id)?.parentId).toBe(group.id)

    const embedded = createEmbeddedDocumentStep([])
    const innerEmbedded = createEmbeddedDocumentStep([])
    const both = roundTrip(pipelineOf(embedded), {
      type: 'add-step',
      step: innerEmbedded,
      index: 0,
      parentId: embedded.id,
    })
    expect(findStep(both, innerEmbedded.id)?.parentId).toBe(embedded.id)
  })

  it('refuses an embedded document layer inside a group, and a list that is not there', () => {
    expect(() =>
      applyChange(grouped, {
        type: 'add-step',
        step: createEmbeddedDocumentStep([]),
        index: 0,
        parentId: group.id,
      }),
    ).toThrow('A group cannot hold an embedded document layer.')
    expect(() =>
      applyChange(grouped, {
        type: 'add-step',
        step: createSharpStep('flip'),
        index: 0,
        parentId: 'missing',
      }),
    ).toThrow(InvalidChangeError)
    expect(() =>
      applyChange(grouped, {
        type: 'add-step',
        step: createSharpStep('flip'),
        index: 0,
        parentId: A.id,
      }),
    ).toThrow(InvalidChangeError)
  })

  it('refuses a container that would hold too many steps', () => {
    const full = createGroupStep(
      Array.from({ length: MAX_GROUP_STEPS }, () => createSharpStep('flop')),
    )

    expect(() =>
      applyChange(pipelineOf(full), {
        type: 'add-step',
        step: createSharpStep('flip'),
        index: 0,
        parentId: full.id,
      }),
    ).toThrow(InvalidChangeError)
  })
})

describe('moving between levels', () => {
  const inner = createGroupStep([C])
  const group = createGroupStep([B, inner])
  const grouped: Pipeline = pipelineOf(A, group, D)

  it('moves a step out to the top, and undo puts it back in its place', () => {
    const next = roundTrip(grouped, { type: 'move-step', stepId: C.id, to: 0 })

    expect(ids(next)).toEqual([C.id, A.id, group.id, D.id])
  })

  it('moves a step into a nested group, and undo takes it out to where it was', () => {
    const next = roundTrip(grouped, {
      type: 'move-step',
      stepId: D.id,
      to: 1,
      parentId: inner.id,
    })

    expect(findStep(next, D.id)).toMatchObject({ parentId: inner.id, index: 1 })
  })

  it('moves a whole group, with what it holds, into another group', () => {
    const other = createGroupStep([])
    const pipeline = pipelineOf(A, group, other)

    const next = roundTrip(pipeline, {
      type: 'move-step',
      stepId: group.id,
      to: 0,
      parentId: other.id,
    })

    expect(findStep(next, C.id)?.parentId).toBe(inner.id)
    expect(findStep(next, group.id)?.parentId).toBe(other.id)
  })

  it('refuses moving a container into itself or into a container it holds', () => {
    expect(() =>
      applyChange(grouped, {
        type: 'move-step',
        stepId: group.id,
        to: 0,
        parentId: group.id,
      }),
    ).toThrow('A step cannot go inside itself.')
    expect(() =>
      applyChange(grouped, {
        type: 'move-step',
        stepId: group.id,
        to: 0,
        parentId: inner.id,
      }),
    ).toThrow('A step cannot go inside itself.')
  })

  it('refuses a step moved into something that holds no steps', () => {
    expect(() =>
      applyChange(grouped, {
        type: 'move-step',
        stepId: D.id,
        to: 0,
        parentId: A.id,
      }),
    ).toThrow(InvalidChangeError)
  })
})

describe('other edits at any depth', () => {
  const inner = createGroupStep([C], 'Mirror')
  const group = createGroupStep([B, inner], 'Soften')
  const grouped: Pipeline = pipelineOf(A, group, D)

  it('removes a nested step or container, and undo puts it back', () => {
    expect(
      findStep(roundTrip(grouped, { type: 'remove-step', stepId: C.id }), C.id),
    ).toBeUndefined()
    expect(
      ids(roundTrip(grouped, { type: 'remove-step', stepId: group.id })),
    ).toEqual([A.id, D.id])
  })

  it('switches and renames a nested group', () => {
    const off = roundTrip(grouped, {
      type: 'set-enabled',
      stepId: inner.id,
      enabled: false,
    })
    expect(findStep(off, inner.id)?.step.enabled).toBe(false)

    const named = roundTrip(grouped, {
      type: 'rename-step',
      stepId: inner.id,
      name: 'Flip',
    })
    expect(findStep(named, inner.id)?.step).toMatchObject({ name: 'Flip' })
  })

  it('edits a step inside a nested group', () => {
    const next = roundTrip(grouped, {
      type: 'set-options',
      stepId: C.id,
      options: { sigma: 9 },
    })

    expect(findStep(next, C.id)?.step).toMatchObject({ options: { sigma: 9 } })
  })

  it('refuses edits a group does not have: options, an image and placement', () => {
    for (const change of [
      { type: 'set-options', stepId: group.id, options: {} },
      { type: 'set-image', stepId: group.id, sourceId: 'x' },
      { type: 'set-layer', stepId: group.id, settings: DEFAULT_LAYER_SETTINGS },
    ] as const) {
      expect(() => applyChange(grouped, change)).toThrow(InvalidChangeError)
    }
  })
})

describe('the change schema with containers', () => {
  it('reads the container changes and the list on add and move', () => {
    const group = createGroupStep([B])
    for (const change of [
      { type: 'group-steps', group },
      { type: 'group-steps', group: createEmbeddedDocumentStep([B]) },
      { type: 'ungroup', stepId: group.id },
      { type: 'add-step', step: C, index: 0, parentId: group.id },
      { type: 'move-step', stepId: C.id, to: 0, parentId: group.id },
      { type: 'set-embedded', stepId: group.id, embedded: true },
    ]) {
      expect(DocumentChangeSchema.safeParse(change).success).toBe(true)
    }
  })

  it('refuses an embedded document layer in a group', () => {
    const nested = createGroupStep([createEmbeddedDocumentStep([B]) as never])

    expect(
      DocumentChangeSchema.safeParse({ type: 'group-steps', group: nested })
        .success,
    ).toBe(false)
  })
})

describe('making a group an embedded document layer', () => {
  const group = createGroupStep([B, C], 'Logo')
  const base: Pipeline = pipelineOf(A, group, D)

  it('turns a group into one, placed with the default settings, and undo turns it back', () => {
    const on = roundTrip(base, {
      type: 'set-embedded',
      stepId: group.id,
      embedded: true,
    })
    expect(findStep(on, group.id)?.step).toEqual({
      ...group,
      kind: PipelineStepKind.EmbeddedDocument,
      ...DEFAULT_LAYER_SETTINGS,
    })
  })

  it('turns one back into a group, dropping its placement, and undo brings the placement back', () => {
    const embedded = {
      ...createEmbeddedDocumentStep([B, C], 'Logo'),
      opacity: 40,
      x: 12,
    }
    const pipeline = pipelineOf(A, embedded)

    const off = roundTrip(pipeline, {
      type: 'set-embedded',
      stepId: embedded.id,
      embedded: false,
    })

    expect(findStep(off, embedded.id)?.step).toEqual({
      id: embedded.id,
      kind: PipelineStepKind.Group,
      name: 'Logo',
      enabled: true,
      steps: [B, C],
    })
  })

  it('refuses turning one that holds an embedded document layer into a group', () => {
    const embedded = createEmbeddedDocumentStep([
      createGroupStep([B]),
      createEmbeddedDocumentStep([C]),
    ])

    expect(() =>
      applyChange(pipelineOf(embedded), {
        type: 'set-embedded',
        stepId: embedded.id,
        embedded: false,
      }),
    ).toThrow('A group cannot hold an embedded document layer.')
  })

  it('refuses turning a group inside a group into one', () => {
    const inner = createGroupStep([B])
    const outer = createGroupStep([inner])

    expect(() =>
      applyChange(pipelineOf(outer), {
        type: 'set-embedded',
        stepId: inner.id,
        embedded: true,
      }),
    ).toThrow('A group cannot hold an embedded document layer.')
  })

  it('does nothing when it already is that, and is only for containers', () => {
    expect(
      planChange(base, {
        type: 'set-embedded',
        stepId: group.id,
        embedded: false,
      }),
    ).toBeNull()
    expect(() =>
      applyChange(base, { type: 'set-embedded', stepId: B.id, embedded: true }),
    ).toThrow(InvalidChangeError)
    expect(() =>
      applyChange(base, {
        type: 'set-embedded',
        stepId: 'nope',
        embedded: true,
      }),
    ).toThrow(InvalidChangeError)
  })

  it('is placed with the layer settings, undoing back to the old ones', () => {
    const embedded = createEmbeddedDocumentStep([B])
    const settings = { ...DEFAULT_LAYER_SETTINGS, opacity: 40, x: 12 }

    const next = roundTrip(pipelineOf(A, embedded), {
      type: 'set-layer',
      stepId: embedded.id,
      settings,
    })

    expect(findStep(next, embedded.id)?.step).toMatchObject(settings)
  })

  it('is kept whole when grouping is undone and redone', () => {
    const placed = { ...createEmbeddedDocumentStep([B, C]), opacity: 30 }
    const next = roundTrip(FLAT, { type: 'group-steps', group: placed })
    const undone = roundTrip(next, { type: 'ungroup', stepId: placed.id })
    expect(undone.steps).toHaveLength(4)
  })
})
