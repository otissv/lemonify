import { z } from 'zod'

import {
  WorkflowEdgeSchema,
  WorkflowNodeKind,
  WorkflowNodeSchema,
  createEndpointNode,
} from '@/features/workflows/workflow-graph'

export const MAX_WORKFLOW_NAME_LENGTH = 80

export const WorkflowNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name.')
  .max(
    MAX_WORKFLOW_NAME_LENGTH,
    `Use ${MAX_WORKFLOW_NAME_LENGTH} characters or fewer.`,
  )

const INPUT_POSITION = { x: 0, y: 0 }
const OUTPUT_POSITION = { x: 640, y: 0 }

const GraphShape = {
  nodes: z.array(WorkflowNodeSchema),
  edges: z.array(WorkflowEdgeSchema),
}

type GraphParts = {
  nodes: ReadonlyArray<z.output<typeof WorkflowNodeSchema>>
  edges: ReadonlyArray<z.output<typeof WorkflowEdgeSchema>>
}

function checkGraph(
  { nodes, edges }: GraphParts,
  context: z.RefinementCtx,
): void {
  const ids = new Set(nodes.map(({ id }) => id))
  for (const edge of edges) {
    if (ids.has(edge.source) && ids.has(edge.target)) continue
    context.addIssue({
      code: 'custom',
      message: `Connection ${edge.id} refers to a step that does not exist`,
    })
  }
  for (const kind of [WorkflowNodeKind.Input, WorkflowNodeKind.Output]) {
    const count = nodes.filter((node) => node.kind === kind).length
    if (count === 1) continue
    context.addIssue({
      code: 'custom',
      message: `A workflow needs exactly one ${kind} step`,
    })
  }
}

/** The steps and connections of a workflow; what is stored and what a run copies. */
export const WorkflowGraphSchema = z.object(GraphShape).superRefine(checkGraph)

export const WorkflowSchema = z
  .object({ id: z.uuid(), name: WorkflowNameSchema, ...GraphShape })
  .superRefine(checkGraph)

export type WorkflowGraph = z.output<typeof WorkflowGraphSchema>
export type Workflow = z.infer<typeof WorkflowSchema>

const NAME_PREFIX = 'Workflow'
const NUMBERED_NAME = new RegExp(`^${NAME_PREFIX} (\\d+)$`)
const DUPLICATE_NAME = 'A workflow with this name already exists.'

function normalise(name: string): string {
  return name.trim().toLocaleLowerCase()
}

/** The name the Add workflow dialog suggests, numbered after the existing workflows. */
export function nextWorkflowName(
  existing: ReadonlyArray<{ name: string }>,
): string {
  let highest = existing.length
  for (const { name } of existing) {
    const number = NUMBERED_NAME.exec(name)?.[1]
    if (number) highest = Math.max(highest, Number(number))
  }
  return `${NAME_PREFIX} ${highest + 1}`
}

/** Why a name cannot be used for a new workflow, or null if it can. */
export function workflowNameProblem(
  name: string,
  existing: ReadonlyArray<{ name: string }>,
): string | null {
  const parsed = WorkflowNameSchema.safeParse(name)
  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Invalid name.'
  const wanted = normalise(parsed.data)
  const taken = existing.some((workflow) => normalise(workflow.name) === wanted)
  return taken ? DUPLICATE_NAME : null
}

/** A new, empty workflow. The name must already have passed `workflowNameProblem`. */
export function createWorkflow(name: string): Workflow {
  return WorkflowSchema.parse({
    id: crypto.randomUUID(),
    name,
    nodes: [
      createEndpointNode(WorkflowNodeKind.Input, INPUT_POSITION),
      createEndpointNode(WorkflowNodeKind.Output, OUTPUT_POSITION),
    ],
    edges: [],
  })
}
