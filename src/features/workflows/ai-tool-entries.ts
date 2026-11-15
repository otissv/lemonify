import { getAiCatalogue, listAiTools } from '@/features/ai/ai-functions'
import { AiToolId } from '@/features/ai/ai-tools'
import type {
  AiCatalogue,
  AiContent,
  AiToolSummary,
} from '@/features/ai/ai-tools'
import { defaultUpscaleSettings } from '@/features/upscale/upscale-settings'
import type { AiNode } from '@/features/workflows/workflow-graph'

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

/** The tool and settings a new step of this tool starts with. */
export function defaultAiContent(entry: AiToolEntry): AiContent<AiNode> {
  switch (entry.tool.id) {
    case AiToolId.Upscale:
      return {
        tool: AiToolId.Upscale,
        settings: defaultUpscaleSettings(entry.catalogue),
      }
  }
}

export function catalogueOf(
  entries: ReadonlyArray<AiToolEntry>,
  tool: AiToolId,
): AiCatalogue | undefined {
  return entries.find((entry) => entry.tool.id === tool)?.catalogue
}
