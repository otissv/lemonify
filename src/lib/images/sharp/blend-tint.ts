import sharp from 'sharp'
import type { Sharp } from 'sharp'

import { SharpOperationError } from './errors.ts'
import { applySharpOp, applySharpOps, isOutputOp } from './ops.ts'
import type { SharpOp, SharpOpStage } from './ops.ts'
import {
  applyPixelOp,
  booleanImage,
  fromRaw,
  isFileBoolean,
  isPixelOp,
  toRaw,
} from './pixel-ops.ts'

const MAX_CHANNEL = 255
const COLOUR_CHANNELS = 3
const WITH_ALPHA = 4

type TintOp = Extract<SharpOp, { op: 'tint' }>

function isTint(step: SharpOp): step is TintOp {
  return step.op === 'tint'
}

/** The strength of a tint colour (its alpha, 1 when it has none), as Sharp reads the colour. */
async function tintStrength(colour: TintOp['colour']): Promise<number> {
  const { data } = await sharp({
    create: { width: 1, height: 1, channels: 4, background: colour },
  })
    .raw()
    .toBuffer({ resolveWithObject: true })
  return (data[COLOUR_CHANNELS] ?? MAX_CHANNEL) / MAX_CHANNEL
}

/**
 * Mixes two same-sized pixel buffers: each colour channel is `base` at
 * strength 0 and `tinted` at strength 1. A trailing alpha channel (4 channels)
 * is kept from `base`.
 */
export function mixTint(
  base: Buffer,
  tinted: Buffer,
  strength: number,
  channels: number,
): Buffer {
  const mixed = Buffer.from(base)
  for (let index = 0; index < base.length; index++) {
    const isAlpha = channels === WITH_ALPHA && index % channels === 3
    if (isAlpha) continue
    const from = base[index] ?? 0
    const to = tinted[index] ?? 0
    mixed[index] = Math.round(from + (to - from) * strength)
  }
  return mixed
}

async function blendTint(
  pipeline: Sharp,
  colour: TintOp['colour'],
  strength: number,
): Promise<Sharp> {
  const base = await toRaw(pipeline)
  const tinted = await toRaw(fromRaw(base).tint(colour))
  return fromRaw({
    ...base,
    data: mixTint(base.data, tinted.data, strength, base.channels),
  })
}

async function runStep(
  pipeline: Sharp,
  step: SharpOp,
  index: number,
): Promise<Sharp> {
  try {
    if (isTint(step)) {
      const strength = await tintStrength(step.colour)
      if (strength < 1) return await blendTint(pipeline, step.colour, strength)
    }
    if (isPixelOp(step)) return await applyPixelOp(pipeline, step)
    if (isFileBoolean(step)) return await booleanImage(pipeline, step)
    return applySharpOp(pipeline, step)
  } catch (error) {
    throw new SharpOperationError(`ops[${index}] (${step.op})`, error)
  }
}

/**
 * Like `applySharpOps`, but it also applies the ops that need the picture's
 * size or pixels (`scale`, `opacity`), and a `tint` whose colour has an alpha
 * below 1 is blended into the image by that alpha. Sharp's own tint ignores alpha, so
 * the steps before such a tint are rendered first and the result is mixed
 * with its tinted copy; the later steps then continue from the mix. Output
 * steps are applied last, wherever they are listed. Rendering the image
 * early drops metadata and animation frames.
 */
export async function applySharpOpsBlended(
  image: Sharp,
  ops: readonly SharpOp[],
  stage: SharpOpStage = 'all',
): Promise<Sharp> {
  let pipeline = image
  if (stage !== 'output') {
    for (const [index, step] of ops.entries()) {
      if (isOutputOp(step)) continue
      pipeline = await runStep(pipeline, step, index)
    }
  }
  if (stage === 'pixels') return pipeline
  return applySharpOps(pipeline, ops, 'output')
}
