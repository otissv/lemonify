import { describe, expect, it } from 'vitest'

import { AiToolId } from '@/features/ai/ai-tools'
import { planSegments, workflowProblem } from '@/features/workflows/segments'
import {
  WorkflowNodeKind,
  addInputSources,
  appendStep,
  createAiNode,
  createSharpNode,
} from '@/features/workflows/workflow-graph'
import type { WorkflowNode } from '@/features/workflows/workflow-graph'
import { createWorkflow } from '@/features/workflows/workflow'

const AT = { x: 0, y: 0 }
const UPSCALE = {
  tool: AiToolId.Upscale,
  settings: { model: 'm', scale: 4, iterations: 1, tta: false },
} as const

function build(...steps: WorkflowNode[]) {
  let graph = addInputSources(createWorkflow('Test'), ['src-1'])
  for (const step of steps) graph = appendStep(graph, step)
  return graph
}

describe('planSegments', () => {
  it('makes one empty Sharp segment for a workflow with no steps', () => {
    expect(planSegments(build())).toEqual([{ kind: 'sharp', nodes: [] }])
  })

  it('groups consecutive Sharp steps into one segment', () => {
    const a = createSharpNode('blur', AT)
    const b = createSharpNode('flip', AT)
    const segments = planSegments(build(a, b))
    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({ kind: 'sharp' })
    expect(
      segments[0]?.kind === 'sharp' && segments[0].nodes.map(({ id }) => id),
    ).toEqual([a.id, b.id])
  })

  it('puts an AI step in its own segment and ends on a Sharp one', () => {
    const before = createSharpNode('blur', AT)
    const ai = createAiNode(UPSCALE, AT)
    const after = createSharpNode('flip', AT)
    const kinds = planSegments(build(before, ai, after)).map(({ kind }) => kind)
    expect(kinds).toEqual(['sharp', 'ai', 'sharp'])
  })

  it('adds an empty closing Sharp segment after a last AI step', () => {
    const segments = planSegments(build(createAiNode(UPSCALE, AT)))
    expect(segments.map(({ kind }) => kind)).toEqual(['ai', 'sharp'])
    expect(segments[1]).toEqual({ kind: 'sharp', nodes: [] })
  })

  it('keeps two AI steps apart', () => {
    const kinds = planSegments(
      build(createAiNode(UPSCALE, AT), createAiNode(UPSCALE, AT)),
    ).map(({ kind }) => kind)
    expect(kinds).toEqual(['ai', 'ai', 'sharp'])
  })
})

describe('workflowProblem', () => {
  it('accepts a connected workflow with an image', () => {
    expect(workflowProblem(build(createSharpNode('flip', AT)))).toBeUndefined()
  })

  it('asks for an image when Input is empty', () => {
    const empty = createWorkflow('Empty')
    expect(workflowProblem({ ...empty, edges: [] })).toMatch(
      /Connect|Add at least/,
    )
    const connected = appendStep(empty, createSharpNode('flip', AT))
    expect(workflowProblem(connected)).toBe('Add at least one image to Input.')
  })

  it('asks for a connection when the line does not reach Output', () => {
    const graph = build(createSharpNode('flip', AT))
    const output = graph.nodes.find(
      ({ kind }) => kind === WorkflowNodeKind.Output,
    )
    const cut = {
      ...graph,
      edges: graph.edges.filter((edge) => edge.target !== output?.id),
    }
    expect(workflowProblem(cut)).toBe(
      'Connect every step from Input to Output.',
    )
  })
})
