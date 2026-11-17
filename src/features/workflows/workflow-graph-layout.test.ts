import { describe, expect, it } from 'vitest'

import { createImageLayerStep } from '@/features/pipeline/layer-kinds'
import { createGroupStep, createSharpStep } from '@/features/pipeline/pipeline'
import { createWorkflow } from '@/features/workflows/workflow'
import type { Workflow } from '@/features/workflows/workflow'
import {
  COLUMN_WIDTH,
  ROW_HEIGHT,
  workflowGraph,
} from '@/features/workflows/workflow-graph-layout'

function withSteps(...steps: Workflow['pipeline']['steps']): Workflow {
  const workflow = createWorkflow('Test')
  return { ...workflow, pipeline: { ...workflow.pipeline, steps } }
}

function positions(workflow: Workflow): Record<string, [number, number]> {
  const found: Record<string, [number, number]> = {}
  for (const node of workflowGraph(workflow).nodes) {
    found[node.id] = [node.x, node.y]
  }
  return found
}

describe('workflowGraph', () => {
  it('draws the canvas, the input images, each step in order and the output in one row', () => {
    const slot = createImageLayerStep()
    const blur = createSharpStep('blur')
    const graph = workflowGraph(withSteps(slot, blur))

    expect(graph.nodes.map(({ id }) => id)).toEqual([
      'canvas',
      'inputs',
      slot.id,
      blur.id,
      'output',
    ])
    expect(graph.nodes.map(({ x, y }) => [x, y])).toEqual([
      [0, 0],
      [COLUMN_WIDTH, 0],
      [COLUMN_WIDTH * 2, 0],
      [COLUMN_WIDTH * 3, 0],
      [COLUMN_WIDTH * 4, 0],
    ])
    expect(graph.edges.map(({ source, target }) => [source, target])).toEqual([
      ['canvas', 'inputs'],
      ['inputs', slot.id],
      [slot.id, blur.id],
      [blur.id, 'output'],
    ])
    expect(graph.edges.every(({ branch }) => !branch)).toBe(true)
  })

  it('has only the canvas, the inputs and the output when there are no steps', () => {
    const graph = workflowGraph(withSteps())

    expect(graph.nodes.map(({ id }) => id)).toEqual([
      'canvas',
      'inputs',
      'output',
    ])
    expect(graph.edges.map(({ source, target }) => [source, target])).toEqual([
      ['canvas', 'inputs'],
      ['inputs', 'output'],
    ])
  })

  it('draws the steps of a group as a branch under it that joins the line again', () => {
    const a = createSharpStep('blur')
    const b = createSharpStep('flip')
    const group = createGroupStep([a, b])
    const after = createSharpStep('flop')
    const graph = workflowGraph(withSteps(group, after))
    const at = positions(withSteps(group, after))

    expect(at[group.id]).toEqual([COLUMN_WIDTH * 2, 0])
    expect(at[a.id]).toEqual([COLUMN_WIDTH * 2, ROW_HEIGHT])
    expect(at[b.id]).toEqual([COLUMN_WIDTH * 3, ROW_HEIGHT])
    expect(at[after.id]).toEqual([COLUMN_WIDTH * 4, 0])
    const branch = graph.edges
      .filter(({ branch: isBranch }) => isBranch)
      .map(({ source, target }) => `${source}>${target}`)
    expect(branch.sort()).toEqual(
      [`${group.id}>${a.id}`, `${a.id}>${b.id}`, `${b.id}>${after.id}`].sort(),
    )
    expect(
      graph.edges.some(
        ({ source, target }) => source === group.id && target === after.id,
      ),
    ).toBe(false)
  })

  it('joins an empty group straight to the next step', () => {
    const group = createGroupStep([])
    const graph = workflowGraph(withSteps(group))

    expect(
      graph.edges.some(
        ({ source, target }) => source === group.id && target === 'output',
      ),
    ).toBe(true)
  })

  it('gives each branch the columns it needs, so two branches never overlap', () => {
    const first = createGroupStep([
      createSharpStep('blur'),
      createSharpStep('flip'),
      createSharpStep('flop'),
    ])
    const second = createGroupStep([createSharpStep('blur')])
    const at = positions(withSteps(first, second))

    expect(at[first.id]?.[0]).toBe(COLUMN_WIDTH * 2)
    expect(at[second.id]?.[0]).toBe(COLUMN_WIDTH * 5)
  })

  it('marks which nodes are steps, and which of those are in a group', () => {
    const inner = createSharpStep('blur')
    const group = createGroupStep([inner])
    const graph = workflowGraph(withSteps(group))
    const byId = new Map(graph.nodes.map((node) => [node.id, node]))

    expect(byId.get('canvas')?.kind).toBe('canvas')
    expect(byId.get('inputs')?.kind).toBe('inputs')
    expect(byId.get('output')?.kind).toBe('output')
    expect(byId.get(group.id)).toMatchObject({ kind: 'step' })
    expect(byId.get(group.id)).not.toHaveProperty('groupId')
    expect(byId.get(inner.id)).toMatchObject({
      kind: 'step',
      groupId: group.id,
    })
  })
})
