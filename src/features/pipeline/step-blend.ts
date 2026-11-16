import { z } from 'zod'

import { SHARP_OP_CATEGORIES } from '@/lib/images/sharp/ops'

import {
  LAYER_BLENDS,
  MAX_LAYER_OPACITY,
  MIN_LAYER_OPACITY,
} from '@/features/pipeline/layer'

/**
 * How the result of a step is blended with the picture as it was before the
 * step: the step's result goes over that picture with this blend mode and
 * opacity. The defaults, normal and 100, mean the result simply replaces it.
 */
export const stepBlendSchema = z.strictObject({
  mode: z.enum(LAYER_BLENDS).default('normal'),
  opacity: z
    .number()
    .min(MIN_LAYER_OPACITY)
    .max(MAX_LAYER_OPACITY)
    .default(MAX_LAYER_OPACITY),
})

export type StepBlend = z.output<typeof stepBlendSchema>

export const DEFAULT_STEP_BLEND: StepBlend = stepBlendSchema.parse({})

/** The tools that are about opacity or layering themselves, which a blend would only repeat. */
const WITHOUT_BLEND: ReadonlySet<string> = new Set(['opacity', 'composite'])

const BLENDABLE: ReadonlyArray<string> = [
  ...SHARP_OP_CATEGORIES.filter,
  ...SHARP_OP_CATEGORIES.colour,
].filter((op) => !WITHOUT_BLEND.has(op))

/** The tools whose result can be blended: filters and colour tools, which keep the size of the picture so there is a picture before the step to blend with. Geometry tools change the size. */
export function blendableOps(): ReadonlyArray<string> {
  return BLENDABLE
}

export function supportsBlend(op: string): boolean {
  return BLENDABLE.includes(op)
}

/** Whether a blend changes anything: the defaults do not. */
export function isDefaultBlend(blend: StepBlend): boolean {
  return (
    blend.mode === DEFAULT_STEP_BLEND.mode &&
    blend.opacity === DEFAULT_STEP_BLEND.opacity
  )
}
