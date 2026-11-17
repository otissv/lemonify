import {
  CANVAS_NODE_ID,
  INPUTS_NODE_ID,
  OUTPUT_NODE_ID,
} from '@/features/workflows/workflow-graph-layout'

/** The parts of a workflow, other than its steps, that the options panel can show. */
export type WorkflowFocus = 'canvas' | 'inputs' | 'output'

/** What the options panel shows: a step, or one of the workflow's own settings. */
export type Selection =
  | { kind: 'none' }
  | { kind: 'step'; id: string }
  | { kind: WorkflowFocus }

export const NO_SELECTION: Selection = { kind: 'none' }
export const CANVAS_SELECTION: Selection = { kind: 'canvas' }
export const INPUTS_SELECTION: Selection = { kind: 'inputs' }
export const OUTPUT_SELECTION: Selection = { kind: 'output' }

export function stepSelection(id: string): Selection {
  return { kind: 'step', id }
}

export function selectedStepId(selection: Selection): string | null {
  return selection.kind === 'step' ? selection.id : null
}

/** The diagram node whose picture the sidebar shows. Nothing selected means the output. */
export function previewNodeIdForSelection(selection: Selection): string {
  switch (selection.kind) {
    case 'step':
      return selection.id
    case 'canvas':
      return CANVAS_NODE_ID
    case 'inputs':
      return INPUTS_NODE_ID
    case 'output':
      return OUTPUT_NODE_ID
    case 'none':
      return OUTPUT_NODE_ID
  }
}

/** Same as `previewNodeIdForSelection`, from primitive store fields (safe inside Zustand selectors). */
export function previewNodeIdForUi(
  focus: WorkflowFocus | undefined,
  stepId: string | undefined,
): string {
  if (focus !== undefined) return previewNodeIdForSelection({ kind: focus })
  if (stepId !== undefined) return stepId
  return OUTPUT_NODE_ID
}
