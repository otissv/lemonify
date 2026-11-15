import { z } from 'zod'

import { aiToolSchema } from '@/features/ai/ai-tools'

import type { OutputSettingsSchema } from '@/features/workflows/output-settings'
import { createWorkflow } from '@/features/workflows/workflow'
import type { WorkflowGraph } from '@/features/workflows/workflow'
import {
  WorkflowNodeKind,
  addInputSources,
  appendStep,
  createAiNode,
  createSharpNode,
  updateOutputSettings,
} from '@/features/workflows/workflow-graph'
import type { WorkflowEdge } from '@/features/workflows/workflow-graph'

const ORIGIN = { x: 0, y: 0 }

/** One step of a workflow written as a plain list: a Sharp operation or an AI tool. */
export const WorkflowStepSpecSchema = z.union([
  z.strictObject({
    op: z.string().min(1),
    options: z.record(z.string(), z.json()).default({}),
  }),
  aiToolSchema({}),
])

export const WorkflowStepSpecsSchema = z.array(WorkflowStepSpecSchema)

export type WorkflowStepSpec = z.output<typeof WorkflowStepSpecSchema>

export type WorkflowGraphSpec = {
  sourceIds: ReadonlyArray<string>
  steps: ReadonlyArray<WorkflowStepSpec>
  output?: z.output<typeof OutputSettingsSchema>
}

/**
 * A graph that runs `steps` in order, from Input (on `sourceIds`) to Output.
 * This is how a command line or a script writes a workflow without laying out
 * nodes: the line is joined and spaced here, as the editor does when a step is
 * added.
 */
export function workflowGraphFromSteps(
  name: string,
  spec: WorkflowGraphSpec,
): WorkflowGraph {
  const base = createWorkflow(name)
  const input = base.nodes.find(({ kind }) => kind === WorkflowNodeKind.Input)
  const output = base.nodes.find(({ kind }) => kind === WorkflowNodeKind.Output)
  if (input === undefined || output === undefined) {
    throw new RangeError('A new workflow has an Input and an Output step.')
  }
  const joined: WorkflowEdge = {
    id: crypto.randomUUID(),
    source: input.id,
    target: output.id,
  }
  let graph: WorkflowGraph = { nodes: base.nodes, edges: [joined] }
  for (const step of spec.steps) {
    graph = appendStep(
      graph,
      'op' in step
        ? { ...createSharpNode(step.op, ORIGIN), options: step.options }
        : createAiNode(step, ORIGIN),
    )
  }
  graph = addInputSources(graph, spec.sourceIds)
  return spec.output === undefined
    ? graph
    : updateOutputSettings(graph, spec.output)
}
