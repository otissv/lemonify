import type { z } from 'zod'

export type JsonValue = z.infer<ReturnType<typeof z.json>>
export type JsonRecord = Record<string, JsonValue>

/** The pictures a document can start from. */
export type BaseImage = 'scene' | 'cutout'

/** The pictures a layer, or a tool that takes a second image, can use. A string that starts with `@` in a tool's options names one of them. */
export type SecondImage = 'overlay' | 'mask' | 'scene'

export interface ToolStep {
  kind: 'tool'
  op: string
  options: JsonRecord
  blend?: { mode: string; opacity: number }
  enabled: boolean
}

export interface LayerStep {
  kind: 'layer'
  image: SecondImage
  settings: JsonRecord
  enabled: boolean
}

export type StepSpec = ToolStep | LayerStep

/** One document to build and compare: its id is the name of its snapshot. */
export interface ToolCase {
  id: string
  base: BaseImage
  steps: StepSpec[]
}

interface Extras {
  base?: BaseImage
  blend?: ToolStep['blend']
  enabled?: boolean
}

export function tool(
  op: string,
  options: JsonRecord = {},
  extras: Pick<Extras, 'blend' | 'enabled'> = {},
): ToolStep {
  return {
    kind: 'tool',
    op,
    options,
    blend: extras.blend,
    enabled: extras.enabled ?? true,
  }
}

export function layer(
  image: SecondImage,
  settings: JsonRecord = {},
  enabled = true,
): LayerStep {
  return { kind: 'layer', image, settings, enabled }
}

export function testCase(
  id: string,
  steps: StepSpec[],
  base: BaseImage = 'scene',
): ToolCase {
  return { id, base, steps }
}
