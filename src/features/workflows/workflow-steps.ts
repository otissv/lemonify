import { AI_TOOLS, AiToolId } from '@/features/ai/ai-tools'
import { EXPORT_FORMAT_LABELS } from '@/features/export/export-settings'
import {
  missingSharpOptions,
  opLabel,
} from '@/features/workflows/sharp-op-fields'
import { WorkflowNodeKind } from '@/features/workflows/workflow-graph'
import type { WorkflowNode } from '@/features/workflows/workflow-graph'

/** The name a step is shown by on the canvas and in the inspector. */
export function stepLabel(node: WorkflowNode): string {
  switch (node.kind) {
    case WorkflowNodeKind.Input:
      return 'Input'
    case WorkflowNodeKind.Output:
      return 'Output'
    case WorkflowNodeKind.Sharp:
      return opLabel(node.op)
    case 'ai':
      return AI_TOOLS[node.tool].label
  }
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`
}

function aiSummary(node: Extract<WorkflowNode, { kind: 'ai' }>): string {
  switch (node.tool) {
    case AiToolId.Upscale:
      return `${node.settings.model} · ${node.settings.scale}×`
  }
}

/** A short line under the step's name saying how it is set up. */
export function stepSummary(node: WorkflowNode): string {
  switch (node.kind) {
    case WorkflowNodeKind.Input:
      if (node.sourceIds.length === 0) return 'No images yet'
      return plural(node.sourceIds.length, 'image', 'images')
    case WorkflowNodeKind.Output: {
      const { format, widths } = node.settings
      const label = EXPORT_FORMAT_LABELS[format]
      if (widths.length === 0) return label
      return `${label} · ${plural(widths.length, 'size', 'sizes')}`
    }
    case 'ai':
      return aiSummary(node)
    case WorkflowNodeKind.Sharp: {
      const missing = missingSharpOptions(node.op, node.options).length
      if (missing > 0) return `Needs ${plural(missing, 'option', 'options')}`
      const count = Object.keys(node.options).length
      if (count === 0) return 'Default options'
      return plural(count, 'option set', 'options set')
    }
  }
}

export function isEndpoint(node: WorkflowNode): boolean {
  return (
    node.kind === WorkflowNodeKind.Input ||
    node.kind === WorkflowNodeKind.Output
  )
}
