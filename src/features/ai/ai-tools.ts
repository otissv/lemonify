import { z } from 'zod'

import { UpscaleSettingsSchema } from '@/features/upscale/upscale-settings'
import type {
  UpscaleCatalogue,
  UpscaleModelSummary,
} from '@/features/upscale/upscale-settings'

/** The ids of the AI tools a Step can run. Adding a tool adds an id, a settings schema and a row in `AI_TOOLS`. */
export enum AiToolId {
  Upscale = 'upscale',
}

export enum WorkerPool {
  Cpu = 'cpu',
  Gpu = 'gpu',
}

/** What a tool's output is. Only finished images exist today; the field is the room left for masks. */
export enum AiOutput {
  Image = 'image',
}

export interface AiToolSummary {
  id: AiToolId
  label: string
  pool: WorkerPool
  output: AiOutput
}

/** What the client and the server both know about each AI tool; the engine and batching live in the server's registry. */
export const AI_TOOLS: Readonly<Record<AiToolId, AiToolSummary>> = {
  [AiToolId.Upscale]: {
    id: AiToolId.Upscale,
    label: 'Upscale',
    pool: WorkerPool.Gpu,
    output: AiOutput.Image,
  },
}

export const AI_TOOL_IDS: ReadonlyArray<AiToolId> = Object.values(AiToolId)

export const AI_STEP_KIND = 'ai'

/**
 * `tool` and that tool's settings, plus whatever `shape` adds. The union is
 * keyed by `tool`, so each tool's settings are checked by its own schema;
 * adding a tool adds one member here.
 */
export function aiToolSchema<Shape extends z.ZodRawShape>(shape: Shape) {
  return z.discriminatedUnion('tool', [
    z.strictObject({
      ...shape,
      tool: z.literal(AiToolId.Upscale),
      settings: UpscaleSettingsSchema,
    }),
  ])
}

/** An AI Step or node: `kind: 'ai'` plus a tool and its settings, plus whatever `shape` adds (an id, a position, whether it is on). */
export function aiStepSchema<Shape extends z.ZodRawShape>(shape: Shape) {
  return aiToolSchema({ ...shape, kind: z.literal(AI_STEP_KIND) })
}

/** The settings of any AI tool. */
export type AiSettings = z.output<ReturnType<typeof aiStepSchema>>['settings']

/** The tool and settings of an AI step or node, as one value so the two always match. */
export type AiContent<Step extends { tool: unknown; settings: unknown }> =
  Step extends unknown ? Pick<Step, 'tool' | 'settings'> : never

/** One model a tool offers. Upscale's models say which scales and noise levels they support. */
export type AiModelSummary = UpscaleModelSummary

/** The models a tool offers and which one a new step starts with. */
export type AiCatalogue = UpscaleCatalogue
