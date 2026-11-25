import { AI_TOOLS, AI_TOOL_IDS } from '@/features/ai/ai-tools'
import { EDITING_OP_NAMES } from '@/features/pipeline/pipeline'
import type { ToolChoice } from '@/features/tools/tool-catalogue'
import { SHARP_OP_GROUPS, opLabel } from '@/features/workflows/sharp-op-fields'

/** The kinds of page an action can be done on. */
export enum Page {
  /** No document or workflow is open. */
  Home = 'home',
  Document = 'document',
  Workflow = 'workflow',
}

/** Something a key can do. The id is what bindings are saved under, so it never changes once shipped. */
export interface ActionDefinition {
  id: string
  label: string
  /** The heading it is listed under. */
  group: string
  /** The pages it applies on. On any other its menu item is hidden and its key does nothing; a key still belongs to one action on every page. */
  contexts: ReadonlyArray<Page>
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

const EVERYWHERE: ReadonlyArray<Page> = [
  Page.Home,
  Page.Document,
  Page.Workflow,
]
const EDITING: ReadonlyArray<Page> = [Page.Document, Page.Workflow]
const DOCUMENT_ONLY: ReadonlyArray<Page> = [Page.Document]
const WORKFLOW_ONLY: ReadonlyArray<Page> = [Page.Workflow]

function action(
  id: string,
  label: string,
  group: string,
  contexts: ReadonlyArray<Page>,
  repeats = false,
): ActionDefinition {
  return { id, label, group, contexts, repeats }
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
    contexts: EDITING,
    repeats: false,
    tool,
  }
}

const STATIC_ACTIONS: ReadonlyArray<ActionDefinition> = [
  action('edit.undo', 'Undo', EDIT, EDITING),
  action('edit.redo', 'Redo', EDIT, EDITING),
  action('edit.addImageLayer', 'Add image layer', EDIT, EDITING),
  action('edit.insertImage', 'Insert image', EDIT, DOCUMENT_ONLY),
  action('edit.replaceImage', 'Replace image', EDIT, DOCUMENT_ONLY),
  action('edit.setCanvas', 'Canvas size', EDIT, EDITING),
  action('edit.showOriginal', 'Show original', EDIT, DOCUMENT_ONLY),
  action('file.newDocument', 'New document', FILE, EVERYWHERE),
  action('file.openImage', 'Open image', FILE, EVERYWHERE),
  action('file.openLibrary', 'Open library image', FILE, EVERYWHERE),
  action('file.importDocument', 'Import document', FILE, EVERYWHERE),
  action('file.exportImage', 'Export image', FILE, DOCUMENT_ONLY),
  action('file.exportDocument', 'Export document', FILE, DOCUMENT_ONLY),
  action('file.close', 'Close document', FILE, EDITING),
  action('step.group', 'Group the selected steps', STEP, EDITING),
  action('step.ungroup', 'Ungroup the selected group', STEP, EDITING),
  action('step.delete', 'Delete the selected step', STEP, EDITING),
  action('step.toggle', 'Hide or show the selected step', STEP, EDITING),
  action('step.moveUp', 'Move the selected step up', STEP, EDITING, true),
  action('step.moveDown', 'Move the selected step down', STEP, EDITING, true),
  action('step.selectUp', 'Select the step above', STEP, EDITING, true),
  action('step.selectDown', 'Select the step below', STEP, EDITING, true),
  action('view.zoomIn', 'Zoom in', VIEW, EDITING, true),
  action('view.zoomOut', 'Zoom out', VIEW, EDITING, true),
  action('view.fit', 'Fit the picture to the window', VIEW, EDITING),
  action('view.actualSize', 'Actual size', VIEW, EDITING),
  action('view.panLeft', 'Move the picture left', VIEW, EDITING, true),
  action('view.panRight', 'Move the picture right', VIEW, EDITING, true),
  action('view.panUp', 'Move the picture up', VIEW, EDITING, true),
  action('view.panDown', 'Move the picture down', VIEW, EDITING, true),
  action('view.panLeftFar', 'Move the picture far left', VIEW, EDITING, true),
  action('view.panRightFar', 'Move the picture far right', VIEW, EDITING, true),
  action('view.panUpFar', 'Move the picture far up', VIEW, EDITING, true),
  action('view.panDownFar', 'Move the picture far down', VIEW, EDITING, true),
  action('view.sidebar', 'Show or hide the sidebar', VIEW, EVERYWHERE),
  action(
    'view.stepPreview',
    'Show or hide the step preview',
    VIEW,
    WORKFLOW_ONLY,
  ),
  action('view.runPanel', 'Show or hide the run panel', VIEW, WORKFLOW_ONLY),
  action('panel.tools', 'Show Tools', PANELS, EDITING),
  action('panel.options', 'Show Options', PANELS, EDITING),
  action('panel.export', 'Show Export', PANELS, DOCUMENT_ONLY),
  action('panel.results', 'Show Results', PANELS, DOCUMENT_ONLY),
  action('panel.document', 'Show Document', PANELS, DOCUMENT_ONLY),
  action('panel.navigator', 'Show Navigator', PANELS, DOCUMENT_ONLY),
  action('help.shortcuts', 'Show keyboard shortcuts', HELP, EVERYWHERE),
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
