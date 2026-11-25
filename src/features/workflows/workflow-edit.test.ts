import { describe, expect, it } from 'vitest'

import { createGroupStep, createSharpStep } from '@/features/pipeline/pipeline'
import type { PipelineStep } from '@/features/pipeline/pipeline'
import { createWorkflow } from '@/features/workflows/workflow'
import type { WorkflowDefinition } from '@/features/workflows/workflow'
import { applyWorkflowChange } from '@/features/workflows/workflow-change'
import type { WorkflowChange } from '@/features/workflows/workflow-change'
import {
  addInputsChange,
  addStepChange,
  moveStepChange,
  removeInputChange,
} from '@/features/workflows/workflow-edit'

function base(): { workflow: WorkflowDefinition; slot: PipelineStep } {
  const { pipeline, inputs, output, canvasSize } = createWorkflow('Test')
  const slot = pipeline.steps[0]
  if (slot === undefined) throw new Error('expected the slot')
  return { workflow: { pipeline, inputs, output, canvasSize }, slot }
}

function made(
  workflow: WorkflowDefinition,
  change: WorkflowChange | undefined,
): WorkflowDefinition {
  if (change === undefined) throw new Error('expected a change')
  return applyWorkflowChange(workflow, change)
}

function ids(workflow: WorkflowDefinition): string[] {
  return workflow.pipeline.steps.map(({ id }) => id)
}

describe('addStepChange', () => {
  it('adds at the end when nothing is selected', () => {
    const { workflow } = base()
    const blur = createSharpStep('blur')

    expect(
      made(workflow, addStepChange(workflow, blur, null)).pipeline.steps.at(-1),
    ).toEqual(blur)
  })

  it('adds right after the selected step', () => {
    const { workflow, slot } = base()
    const first = createSharpStep('blur')
    const withTwo = made(workflow, addStepChange(workflow, first, slot.id))
    const second = createSharpStep('flip')

    const next = made(withTwo, addStepChange(withTwo, second, slot.id))

    expect(ids(next)).toEqual([slot.id, second.id, first.id])
  })

  it('adds after a step inside a group, in that group', () => {
    const { workflow } = base()
    const inner = createSharpStep('blur')
    const group = createGroupStep([inner])
    const grouped = made(workflow, addStepChange(workflow, group, null))
    const added = createSharpStep('flip')

    const next = made(grouped, addStepChange(grouped, added, inner.id))

    const found = next.pipeline.steps.find(({ id }) => id === group.id)
    expect(found?.kind === 'group' && found.steps.map(({ id }) => id)).toEqual([
      inner.id,
      added.id,
    ])
  })

  it('adds into a group that is selected, at its end', () => {
    const { workflow } = base()
    const group = createGroupStep([createSharpStep('blur')])
    const grouped = made(workflow, addStepChange(workflow, group, null))
    const added = createSharpStep('flip')

    const next = made(grouped, addStepChange(grouped, added, group.id))

    const found = next.pipeline.steps.find(({ id }) => id === group.id)
    expect(found?.kind === 'group' && found.steps.at(-1)?.id).toBe(added.id)
  })

  it('adds a group at the top even when a step in a group is selected', () => {
    const { workflow } = base()
    const inner = createSharpStep('blur')
    const grouped = made(
      workflow,
      addStepChange(workflow, createGroupStep([inner]), null),
    )
    const group = createGroupStep([])

    const next = made(grouped, addStepChange(grouped, group, inner.id))

    expect(ids(next)).toContain(group.id)
  })
})

describe('moveStepChange', () => {
  it('moves a step one place and stops at the ends', () => {
    const { workflow, slot } = base()
    const blur = createSharpStep('blur')
    const two = made(workflow, addStepChange(workflow, blur, null))

    const moved = made(two, moveStepChange(two, blur.id, -1))

    expect(ids(moved)).toEqual([blur.id, slot.id])
    expect(moveStepChange(moved, blur.id, -1)).toBeUndefined()
    expect(moveStepChange(moved, slot.id, 1)).toBeUndefined()
  })

  it('moves a step within its group', () => {
    const { workflow } = base()
    const a = createSharpStep('blur')
    const b = createSharpStep('flip')
    const group = createGroupStep([a, b])
    const grouped = made(workflow, addStepChange(workflow, group, null))

    const moved = made(grouped, moveStepChange(grouped, b.id, -1))

    const found = moved.pipeline.steps.find(({ id }) => id === group.id)
    expect(found?.kind === 'group' && found.steps.map(({ id }) => id)).toEqual([
      b.id,
      a.id,
    ])
  })

  it('does nothing for a step that is not there', () => {
    const { workflow } = base()
    expect(moveStepChange(workflow, 'nope', 1)).toBeUndefined()
  })
})

describe('inputs', () => {
  it('adds input images once each and removes one', () => {
    const { workflow } = base()

    const added = made(workflow, addInputsChange(workflow, ['a', 'b', 'a']))

    expect(added.inputs).toEqual(['a', 'b'])
    expect(addInputsChange(added, ['b'])).toBeUndefined()
    expect(made(added, removeInputChange(added, 'a')).inputs).toEqual(['b'])
    expect(removeInputChange(added, 'zzz')).toBeUndefined()
  })
})
