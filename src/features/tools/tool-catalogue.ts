import { AI_TOOLS } from '@/features/ai/ai-tools'
import type { AiToolId, AiToolSummary } from '@/features/ai/ai-tools'
import { EDITING_OP_NAMES } from '@/features/pipeline/pipeline'
import { SHARP_OP_GROUPS, opLabel } from '@/features/workflows/sharp-op-fields'

/** The value of the tool that adds an Open image step. */
export const OPEN_IMAGE_TOOL = 'open-image'

/** A tool that can be added to a document's pipeline as a step: a Sharp operation or an AI tool. */
export type ToolEntry =
  | { kind: 'source'; value: typeof OPEN_IMAGE_TOOL; label: string }
  | { kind: 'sharp'; value: string; label: string }
  | { kind: 'ai'; value: AiToolId; label: string }

export interface ToolGroup {
  label: string
  tools: ReadonlyArray<ToolEntry>
}

function imageGroup(): ToolGroup {
  return {
    label: 'Image',
    tools: [{ kind: 'source', value: OPEN_IMAGE_TOOL, label: 'Open image' }],
  }
}

function aiGroup(tools: ReadonlyArray<AiToolSummary>): ToolGroup {
  return {
    label: 'AI',
    tools: tools.map(({ id }) => ({
      kind: 'ai',
      value: id,
      label: AI_TOOLS[id].label,
    })),
  }
}

function editingGroups(): Array<ToolGroup> {
  const groups: Array<ToolGroup> = []
  for (const group of SHARP_OP_GROUPS) {
    const tools: Array<ToolEntry> = []
    for (const op of group.ops) {
      if (EDITING_OP_NAMES.includes(op)) {
        tools.push({ kind: 'sharp', value: op, label: opLabel(op) })
      }
    }
    if (tools.length > 0) groups.push({ label: group.label, tools })
  }
  return groups
}

/** Every tool that adds a step, grouped: Open image, the server's AI tools, then Sharp's Geometry, Filters and Colour. The Output group is left to Export. */
export function toolGroups(
  aiTools: ReadonlyArray<AiToolSummary>,
): Array<ToolGroup> {
  const ai = aiGroup(aiTools)
  return [
    imageGroup(),
    ...(ai.tools.length > 0 ? [ai] : []),
    ...editingGroups(),
  ]
}

/** The tools whose name contains `query` (ignoring case and spaces); groups with none are left out. */
export function searchTools(
  groups: ReadonlyArray<ToolGroup>,
  query: string,
): Array<ToolGroup> {
  const wanted = query.replace(/\s+/g, '').toLowerCase()
  if (wanted === '') return [...groups]
  const found: Array<ToolGroup> = []
  for (const group of groups) {
    const tools: Array<ToolEntry> = []
    for (const tool of group.tools) {
      const name = `${tool.label}${tool.value}`
        .replace(/\s+/g, '')
        .toLowerCase()
      if (name.includes(wanted)) tools.push(tool)
    }
    if (tools.length > 0) found.push({ ...group, tools })
  }
  return found
}
