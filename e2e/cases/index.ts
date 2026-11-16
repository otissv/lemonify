import type { ToolCase } from '../case-types.ts'
import { BLEND_CASES } from './blend.ts'
import { COLOUR_CASES } from './colour.ts'
import { FILTER_CASES } from './filters.ts'
import { GEOMETRY_CASES } from './geometry.ts'
import { LAYER_CASES } from './layers.ts'

/** Every document the end-to-end tests build, in the order they are listed. */
export const CASES: ReadonlyArray<ToolCase> = [
  ...GEOMETRY_CASES,
  ...FILTER_CASES,
  ...COLOUR_CASES,
  ...BLEND_CASES,
  ...LAYER_CASES,
]
