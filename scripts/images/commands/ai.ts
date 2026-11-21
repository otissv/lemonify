import { z } from 'zod'

import { AiToolId } from '../../../src/features/ai/ai-tools.ts'
import type {
  AiCatalogue,
  AiToolSummary,
} from '../../../src/features/ai/ai-tools.ts'
import { defineAppCommand } from '../app-command.ts'

const ID_COLUMN = 12
const NAME_COLUMN = 44

function formatTools({ tools }: { tools: AiToolSummary[] }): string {
  if (tools.length === 0) return 'No AI tools are available.'
  const lines: string[] = []
  for (const tool of tools) {
    lines.push(
      `${tool.id.padEnd(ID_COLUMN)}${tool.label}  (${tool.pool}, makes ${tool.output})`,
    )
  }
  return lines.join('\n')
}

function formatCatalogue({
  catalogue,
}: {
  tool: AiToolId
  catalogue: AiCatalogue
}): string {
  const lines: string[] = []
  for (const model of catalogue.models) {
    const mark = model.name === catalogue.defaultModel ? '* ' : '  '
    lines.push(
      `${mark}${model.name.padEnd(NAME_COLUMN)}${model.category}  ${model.scales.join(',')}x`,
    )
  }
  lines.push('', '* the model a new step starts with')
  return lines.join('\n')
}

export const aiToolsCommand = defineAppCommand({
  name: 'ai tools',
  summary: 'List the AI tools a step can run',
  synopsis: '',
  help: `Lists the AI tools the server can run, as the Tools panel's AI group shows\nthem. Add one to a document with 'document step add <id> --ai <tool>'.`,
  shape: {},
  async run({ app }) {
    return { tools: app.aiTools.list() }
  },
  format: formatTools,
})

export const aiCatalogueCommand = defineAppCommand({
  name: 'ai catalogue',
  summary: "List an AI tool's models and the one a new step starts with",
  synopsis: '<tool>',
  help: `Lists the models an AI tool offers, with the scales each supports, and\nmarks the one a new step starts with, as the step's settings panel offers\nthem. Tools: ${Object.values(AiToolId).join(', ')}.`,
  shape: { tool: z.enum(AiToolId) },
  positionals: ['tool'],
  async run({ app, options }) {
    return {
      tool: options.tool,
      catalogue: await app.aiTools.catalogue(options.tool),
    }
  },
  format: formatCatalogue,
})
