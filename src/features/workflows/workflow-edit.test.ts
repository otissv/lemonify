import { describe, expect, it } from 'vitest'

import { canvasOfSize } from '@/features/pipeline/canvas'
import { createImageLayerStep } from '@/features/pipeline/layer-kinds'
import { createGroupStep, createSharpStep } from '@/features/pipeline/pipeline'
import { defaultOutputSettings } from '@/features/workflows/output-settings'
import { createWorkflow } from '@/features/workflows/workflow'
import {
  addInputs,
  addStepAfter,
  changePipeline,
  moveStepBy,
  removeInput,
  withOutput,
} from '@/features/workflows/workflow-edit'

function base() {
  const workflow = createWorkflow('Test')
  const slot = workflow.pipeline.steps[0]
  if (slot === undefined) throw new Error('expected the slot')
  return { workflow, slot }
}

describe('changePipeline', () => {
  it('applies a document change to the pipeline and keeps the rest', () => {
    const { workflow } = base()
    const next = changePipeline(workflow, {
      type: 'set-canvas',
      canvas: canvasOfSize(10, 20),
    })

    expect(next.pipeline.canvas).toEqual({
      width: 10,
      height: 20,
      background: 'transparent',
    })
    expect(next.id).toBe(workflow.id)
    expect(next.inputs).toBe(workflow.inputs)
  })

  it('returns the same workflow when the change leaves it as it was', () => {
    const { workflow, slot } = base()

    expect(
      changePipeline(workflow, {
        type: 'set-enabled',
        stepId: slot.id,
        enabled: true,
      }),
    ).toBe(workflow)
  })
})

describe('addStepAfter', () => {
  it('adds at the end when nothing is selected', () => {
    const { workflow } = base()
    const blur = createSharpStep('blur')

    expect(addStepAfter(workflow, blur, null).pipeline.steps.at(-1)).toEqual(
      blur,
    )
  })

  it('adds right after the selected step', () => {
    const { workflow, slot } = base()
    const first = createSharpStep('blur')
    const withTwo = addStepAfter(workflow, first, slot.id)
    const second = createSharpStep('flip')

    const next = addStepAfter(withTwo, second, slot.id)

    expect(next.pipeline.steps.map(({ id }) => id)).toEqual([
      slot.id,
      second.id,
      first.id,
    ])
  })

  it('adds after a step inside a group, in that group', () => {
    const { workflow } = base()
    const inner = createSharpStep('blur')
    const group = createGroupStep([inner])
    const grouped = addStepAfter(workflow, group, null)
    const added = createSharpStep('flip')

    const next = addStepAfter(grouped, added, inner.id)

    const found = next.pipeline.steps.find(({ id }) => id === group.id)
    expect(found?.kind === 'group' && found.steps.map(({ id }) => id)).toEqual([
      inner.id,
      added.id,
    ])
  })

  it('adds into a group that is selected, at its end', () => {
    const { workflow } = base()
    const group = createGroupStep([createSharpStep('blur')])
    const grouped = addStepAfter(workflow, group, null)
    const added = createSharpStep('flip')

    const next = addStepAfter(grouped, added, group.id)

    const found = next.pipeline.steps.find(({ id }) => id === group.id)
    expect(found?.kind === 'group' && found.steps.at(-1)?.id).toBe(added.id)
  })

  it('adds a group at the top even when a step in a group is selected', () => {
    const { workflow } = base()
    const inner = createSharpStep('blur')
    const grouped = addStepAfter(workflow, createGroupStep([inner]), null)
    const group = createGroupStep([])

    const next = addStepAfter(grouped, group, inner.id)

    expect(next.pipeline.steps.map(({ id }) => id)).toContain(group.id)
  })
})

describe('moveStepBy', () => {
  it('moves a step one place and stops at the ends', () => {
    const { workflow, slot } = base()
    const blur = createSharpStep('blur')
    const two = addStepAfter(workflow, blur, null)

    const moved = moveStepBy(two, blur.id, -1)

    expect(moved.pipeline.steps.map(({ id }) => id)).toEqual([blur.id, slot.id])
    expect(moveStepBy(moved, blur.id, -1)).toBe(moved)
    expect(moveStepBy(moved, slot.id, 1)).toBe(moved)
  })

  it('moves a step within its group', () => {
    const { workflow } = base()
    const a = createSharpStep('blur')
    const b = createSharpStep('flip')
    const group = createGroupStep([a, b])
    const grouped = addStepAfter(workflow, group, null)

    const moved = moveStepBy(grouped, b.id, -1)

    const found = moved.pipeline.steps.find(({ id }) => id === group.id)
    expect(found?.kind === 'group' && found.steps.map(({ id }) => id)).toEqual([
      b.id,
      a.id,
    ])
  })

  it('leaves the workflow as it was for a step that is not there', () => {
    const { workflow } = base()
    expect(moveStepBy(workflow, 'nope', 1)).toBe(workflow)
  })
})

describe('inputs and output', () => {
  it('adds input images once each and removes one', () => {
    const { workflow } = base()

    const added = addInputs(workflow, ['a', 'b', 'a'])

    expect(added.inputs).toEqual(['a', 'b'])
    expect(addInputs(added, ['b'])).toBe(added)
    expect(removeInput(added, 'a').inputs).toEqual(['b'])
    expect(removeInput(added, 'zzz')).toBe(added)
  })

  it('sets the output settings', () => {
    const { workflow } = base()
    const output = { ...defaultOutputSettings(), widths: [100] }

    expect(withOutput(workflow, output).output).toEqual(output)
  })
})

describe('a workflow with image layers', () => {
  it('fills a layer with a fixed image with set-image, and empties it again', () => {
    const { workflow } = base()
    const layer = createImageLayerStep()
    const added = addStepAfter(workflow, layer, null)

    const filled = changePipeline(added, {
      type: 'set-image',
      stepId: layer.id,
      sourceId: 'logo',
    })

    expect(filled.pipeline.steps.at(-1)).toMatchObject({ sourceId: 'logo' })
    expect(
      changePipeline(filled, {
        type: 'set-image',
        stepId: layer.id,
        sourceId: null,
      }).pipeline.steps.at(-1),
    ).not.toHaveProperty('sourceId')
  })
})
