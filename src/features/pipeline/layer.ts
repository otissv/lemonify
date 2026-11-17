import { z } from 'zod'

/** How a layer's colours combine with the picture under it. */
export const LAYER_BLENDS = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'colour-dodge',
  'colour-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
] as const

/** How a layer's image is sized to the canvas, before its scale is applied. */
export const LAYER_FITS = [
  'inside',
  'original',
  'contain',
  'cover',
  'stretch',
] as const

/** Which point of the canvas a layer is placed against, and which point of the layer touches it. */
export const LAYER_ANCHORS = [
  'northwest',
  'north',
  'northeast',
  'west',
  'centre',
  'east',
  'southwest',
  'south',
  'southeast',
] as const

export type LayerBlend = (typeof LAYER_BLENDS)[number]
export type LayerFit = (typeof LAYER_FITS)[number]
export type LayerAnchor = (typeof LAYER_ANCHORS)[number]

export const MIN_LAYER_OPACITY = 0
export const MAX_LAYER_OPACITY = 100
export const MIN_LAYER_SCALE = 1
export const MAX_LAYER_SCALE = 1000
export const MAX_LAYER_ROTATION = 180
export const MAX_LAYER_OFFSET = 100_000

/** What a layer does with its image, apart from which image it is. Every setting has a default, so a layer can be written with only what differs. */
export const layerSettingsSchema = z.strictObject({
  opacity: z
    .number()
    .min(MIN_LAYER_OPACITY)
    .max(MAX_LAYER_OPACITY)
    .default(MAX_LAYER_OPACITY),
  blend: z.enum(LAYER_BLENDS).default('normal'),
  fit: z.enum(LAYER_FITS).default('inside'),
  scale: z.number().min(MIN_LAYER_SCALE).max(MAX_LAYER_SCALE).default(100),
  rotation: z
    .number()
    .min(-MAX_LAYER_ROTATION)
    .max(MAX_LAYER_ROTATION)
    .default(0),
  anchor: z.enum(LAYER_ANCHORS).default('centre'),
  x: z.number().int().min(-MAX_LAYER_OFFSET).max(MAX_LAYER_OFFSET).default(0),
  y: z.number().int().min(-MAX_LAYER_OFFSET).max(MAX_LAYER_OFFSET).default(0),
})

export type LayerSettings = z.output<typeof layerSettingsSchema>

export const DEFAULT_LAYER_SETTINGS: LayerSettings = layerSettingsSchema.parse(
  {},
)

/** The placement settings of anything that is placed on the picture like a layer: every kind of layer, and a sub-document. */
export function layerSettingsOf(placed: LayerSettings): LayerSettings {
  const { opacity, blend, fit, scale, rotation, anchor, x, y } = placed
  return { opacity, blend, fit, scale, rotation, anchor, x, y }
}
