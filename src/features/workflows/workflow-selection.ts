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
