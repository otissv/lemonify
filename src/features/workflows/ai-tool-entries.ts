import type { AiToolId } from '@/features/ai/ai-tools'
import { getAiCatalogue, listAiTools } from '@/features/ai/ai-functions'
import type { AiCatalogue, AiToolSummary } from '@/features/ai/ai-tools'

/** An AI tool the server can run, with the models it offers. Plain data, so a route can load it. */
export interface AiToolEntry {
  tool: AiToolSummary
  catalogue: AiCatalogue
}

/** The tools the server can run, each with its catalogue. */
export async function loadAiToolEntries(): Promise<Array<AiToolEntry>> {
  const tools = await listAiTools()
  return Promise.all(
    tools.map(async (tool) => ({
      tool,
      catalogue: await getAiCatalogue({ data: { tool: tool.id } }),
    })),
  )
}

export function catalogueOf(
  entries: ReadonlyArray<AiToolEntry>,
  tool: AiToolId,
): AiCatalogue | undefined {
  return entries.find((entry) => entry.tool.id === tool)?.catalogue
}
