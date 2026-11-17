import { AI_TOOLS, AI_TOOL_IDS } from '@/features/ai/ai-tools'
import { EDITING_OP_NAMES } from '@/features/pipeline/pipeline'
import type { ToolChoice } from '@/features/tools/tool-catalogue'
import { SHARP_OP_GROUPS, opLabel } from '@/features/workflows/sharp-op-fields'

/** Something a key can do. The id is what bindings are saved under, so it never changes once shipped. */
export interface ActionDefinition {
  id: string
  label: string
  /** The heading it is listed under. */
  group: string
  /** Whether holding the key does it again and again. */
  repeats: boolean
  /** The tool this action adds as a step, for the actions that add one. */
  tool?: ToolChoice
}

const EDIT = 'Edit'
const FILE = 'File'
const STEP = 'Step'
const VIEW = 'View'
const PANELS = 'Panels'
const HELP = 'Help'

function action(
  id: string,
  label: string,
  group: string,
  repeats = false,
): ActionDefinition {
  return { id, label, group, repeats }
}

function toolAction(
  tool: ToolChoice,
  label: string,
  group: string,
): ActionDefinition {
  return {
    id: toolActionId(tool.kind, tool.value),
    label,
    group,
    repeats: false,
    tool,
  }
}

const STATIC_ACTIONS: ReadonlyArray<ActionDefinition> = [
  action('edit.undo', 'Undo', EDIT),
  action('edit.redo', 'Redo', EDIT),
  action('edit.insertImage', 'Insert image', EDIT),
  action('edit.replaceImage', 'Replace image', EDIT),
  action('edit.showOriginal', 'Show original', EDIT),
  action('file.openImage', 'Open image', FILE),
  action('file.openLibrary', 'Open library image', FILE),
  action('file.importDocument', 'Import document', FILE),
  action('file.exportImage', 'Export image', FILE),
  action('file.exportDocument', 'Export document', FILE),
  action('file.close', 'Close document', FILE),
  action('step.group', 'Group the selected steps', STEP),
  action('step.ungroup', 'Ungroup the selected group', STEP),
  action('step.delete', 'Delete the selected step', STEP),
  action('step.toggle', 'Hide or show the selected step', STEP),
  action('step.moveUp', 'Move the selected step up', STEP, true),
  action('step.moveDown', 'Move the selected step down', STEP, true),
  action('step.selectUp', 'Select the step above', STEP, true),
  action('step.selectDown', 'Select the step below', STEP, true),
  action('view.zoomIn', 'Zoom in', VIEW, true),
  action('view.zoomOut', 'Zoom out', VIEW, true),
  action('view.fit', 'Fit the picture to the window', VIEW),
  action('view.actualSize', 'Actual size', VIEW),
  action('view.panLeft', 'Move the picture left', VIEW, true),
  action('view.panRight', 'Move the picture right', VIEW, true),
  action('view.panUp', 'Move the picture up', VIEW, true),
  action('view.panDown', 'Move the picture down', VIEW, true),
  action('view.panLeftFar', 'Move the picture far left', VIEW, true),
  action('view.panRightFar', 'Move the picture far right', VIEW, true),
  action('view.panUpFar', 'Move the picture far up', VIEW, true),
  action('view.panDownFar', 'Move the picture far down', VIEW, true),
  action('view.sidebar', 'Show or hide the sidebar', VIEW),
  action('panel.tools', 'Show Tools', PANELS),
  action('panel.options', 'Show Options', PANELS),
  action('panel.export', 'Show Export', PANELS),
  action('panel.results', 'Show Results', PANELS),
  action('panel.document', 'Show Document', PANELS),
  action('panel.navigator', 'Show Navigator', PANELS),
  action('help.shortcuts', 'Show keyboard shortcuts', HELP),
]

const TOOL_GROUP_PREFIX = 'Add tool: '
const AI_GROUP = `${TOOL_GROUP_PREFIX}AI`

/** The id of the action that adds a tool to the document as a step. */
export function toolActionId(kind: 'sharp' | 'ai', value: string): string {
  return `tool.${kind}.${value}`
}

function toolActions(): ActionDefinition[] {
  const tools: ActionDefinition[] = []
  for (const id of AI_TOOL_IDS) {
    tools.push(
      toolAction(
        { kind: 'ai', value: id },
        `Add ${AI_TOOLS[id].label}`,
        AI_GROUP,
      ),
    )
  }
  for (const group of SHARP_OP_GROUPS) {
    for (const op of group.ops) {
      if (!EDITING_OP_NAMES.includes(op)) continue
      tools.push(
        toolAction(
          { kind: 'sharp', value: op },
          `Add ${opLabel(op)}`,
          `${TOOL_GROUP_PREFIX}${group.label}`,
        ),
      )
    }
  }
  return tools
}

/** Every action keys can be bound to, in the order they are listed. */
export const ACTIONS: ReadonlyArray<ActionDefinition> = [
  ...STATIC_ACTIONS,
  ...toolActions(),
]

const BY_ID: ReadonlyMap<string, ActionDefinition> = new Map(
  ACTIONS.map((definition) => [definition.id, definition]),
)

export function actionById(id: string): ActionDefinition | undefined {
  return BY_ID.get(id)
}

export function isActionId(id: string): boolean {
  return BY_ID.has(id)
}
