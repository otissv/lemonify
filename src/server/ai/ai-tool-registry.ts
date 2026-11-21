import { AI_TOOLS, AiToolId } from '@/features/ai/ai-tools'
import type {
  AiCatalogue,
  AiSettings,
  AiToolSummary,
} from '@/features/ai/ai-tools'

import { ValidationError } from '../errors.ts'
import type { AiEngine } from './ai-engine.ts'

/** A tool the server can run: what the client knows, plus the engine and how its images batch. */
export interface AiToolEntry {
  summary: AiToolSummary
  engine: AiEngine
  /** Images whose steps give equal keys can run in one batch. */
  batchKey(settings: AiSettings): string
  /** A lower cap than the configured batch size, for tools that need one. */
  maxBatch?: number
}

/** Batching by identical settings, which is right for any tool that has one model load per settings. */
export function batchBySettings(
  tool: AiToolId,
): (settings: AiSettings) => string {
  return (settings) => `${tool}:${JSON.stringify(sortedEntries(settings))}`
}

function sortedEntries(settings: AiSettings): Array<[string, unknown]> {
  return Object.entries(settings).sort(([a], [b]) => a.localeCompare(b))
}

/**
 * The AI tools the server can run. Adding a tool is one entry here and, when
 * its engine is new, one `AiEngine`; nothing else in the server changes.
 */
export class AiToolRegistry {
  readonly #entries: ReadonlyMap<AiToolId, AiToolEntry>

  constructor(entries: ReadonlyArray<AiToolEntry>) {
    this.#entries = new Map(entries.map((entry) => [entry.summary.id, entry]))
  }

  get(tool: AiToolId): AiToolEntry {
    const entry = this.#entries.get(tool)
    if (entry === undefined) {
      throw new ValidationError(`The AI tool "${tool}" is not available.`)
    }
    return entry
  }

  list(): AiToolSummary[] {
    return [...this.#entries.values()].map((entry) => entry.summary)
  }

  /** The models a tool offers and which one a new step starts with. */
  async catalogue(tool: AiToolId): Promise<AiCatalogue> {
    return this.get(tool).engine.catalogue(tool)
  }
}

export function upscaleEntry(engine: AiEngine): AiToolEntry {
  return {
    summary: AI_TOOLS[AiToolId.Upscale],
    engine,
    batchKey: batchBySettings(AiToolId.Upscale),
  }
}
