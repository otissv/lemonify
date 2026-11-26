import { describe, expect, it } from 'vitest'

import { createImageLayerStep } from '@/features/pipeline/layer-kinds'
import {
  createEmbeddedDocumentStep,
  createGroupStep,
  createSharpStep,
} from '@/features/pipeline/pipeline'
import { createWorkflow } from '@/features/workflows/workflow'
import type { Workflow } from '@/features/workflows/workflow'
import {
  COLUMN_WIDTH,
  FRAME_HEADER,
  FRAME_PADDING,
  NODE_GAP,
  NODE_HEIGHT,
  NODE_WIDTH,
  workflowGraph,
  workflowPreviewNodeIds,
} from '@/features/workflows/workflow-graph-layout'
import type { GraphNode } from '@/features/workflows/workflow-graph-layout'

function withSteps(...steps: Workflow['pipeline']['steps']): Workflow {
  const workflow = createWorkflow('Test')
  return { ...workflow, pipeline: { ...workflow.pipeline, steps } }
}

function byId(workflow: Workflow): Map<string, GraphNode> {
  return new Map(workflowGraph(workflow).nodes.map((node) => [node.id, node]))
}

function links(workflow: Workflow): string[][] {
  return workflowGraph(workflow).edges.map(({ source, target }) => [
    source,
    target,
  ])
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
    expect(links(withSteps(slot, blur))).toEqual([
      ['canvas', 'inputs'],
      ['inputs', slot.id],
      [slot.id, blur.id],
      [blur.id, 'output'],
    ])
  })

  it('has only the canvas, the inputs and the output when there are no steps', () => {
    expect(links(withSteps())).toEqual([
      ['canvas', 'inputs'],
      ['inputs', 'output'],
    ])
  })

  it('draws a group as a frame around its steps, which the line runs through', () => {
    const a = createSharpStep('blur')
    const b = createSharpStep('flip')
    const group = createGroupStep([a, b])
    const after = createSharpStep('flop')
    const workflow = withSteps(group, after)
    const nodes = byId(workflow)

    expect(nodes.get(group.id)).toMatchObject({
      kind: 'frame',
      x: COLUMN_WIDTH * 2,
      y: 0,
      width: 2 * NODE_WIDTH + NODE_GAP + 2 * FRAME_PADDING,
      height: FRAME_HEADER + NODE_HEIGHT + FRAME_PADDING,
    })
    expect(nodes.get(a.id)).toMatchObject({
      kind: 'step',
      parentId: group.id,
      x: FRAME_PADDING,
      y: FRAME_HEADER,
    })
    expect(nodes.get(b.id)).toMatchObject({
      parentId: group.id,
      x: FRAME_PADDING + COLUMN_WIDTH,
    })
    const frameWidth = nodes.get(group.id)?.width ?? 0
    expect(nodes.get(after.id)?.x).toBe(
      COLUMN_WIDTH * 2 + frameWidth + NODE_GAP,
    )
    expect(links(workflow)).toEqual([
      ['canvas', 'inputs'],
      ['inputs', a.id],
      [a.id, b.id],
      [b.id, after.id],
      [after.id, 'output'],
    ])
  })

  it('lists a frame before the steps inside it', () => {
    const inner = createSharpStep('blur')
    const group = createGroupStep([inner])
    const ids = workflowGraph(withSteps(group)).nodes.map(({ id }) => id)

    expect(ids.indexOf(group.id)).toBeLessThan(ids.indexOf(inner.id))
  })

  it('nests frames for groups and embedded document layers at any depth', () => {
    const blur = createSharpStep('blur')
    const inner = createGroupStep([blur])
    const embedded = createEmbeddedDocumentStep([createImageLayerStep(), inner])
    const nodes = byId(withSteps(embedded))

    expect(nodes.get(embedded.id)).toMatchObject({ kind: 'frame' })
    expect(nodes.get(inner.id)).toMatchObject({
      kind: 'frame',
      parentId: embedded.id,
      x: FRAME_PADDING + COLUMN_WIDTH,
      y: FRAME_HEADER,
    })
    expect(nodes.get(blur.id)).toMatchObject({
      parentId: inner.id,
      x: FRAME_PADDING,
      y: FRAME_HEADER,
    })
    expect(nodes.get(embedded.id)?.height).toBe(
      2 * FRAME_HEADER + NODE_HEIGHT + 2 * FRAME_PADDING,
    )
  })

  it('runs the line through an empty frame', () => {
    const group = createGroupStep([])
    const workflow = withSteps(group)

    expect(byId(workflow).get(group.id)?.width).toBe(
      NODE_WIDTH + 2 * FRAME_PADDING,
    )
    expect(links(workflow)).toEqual([
      ['canvas', 'inputs'],
      ['inputs', group.id],
      [group.id, 'output'],
    ])
  })

  it('names every node for the previews, frames included', () => {
    const inner = createSharpStep('blur')
    const group = createGroupStep([inner])

    expect(workflowPreviewNodeIds(withSteps(group))).toEqual([
      'canvas',
      'inputs',
      group.id,
      inner.id,
      'output',
    ])
  })
})
