import sharp from 'sharp'
import type { Sharp } from 'sharp'

import type { SharpOp } from './ops.ts'

const MAX_CHANNEL = 255
const PERCENT = 100
const ALPHA = 3
const WITH_ALPHA = 4

/** An op that needs the picture's size or pixels, so it is applied between renders instead of being chained onto Sharp. */
export type PixelOp = Extract<SharpOp, { op: 'scale' | 'opacity' }>

export interface RawImage {
  data: Buffer
  width: number
  height: number
  channels: number
}

export function isPixelOp(step: SharpOp): step is PixelOp {
  return step.op === 'scale' || step.op === 'opacity'
}

/** The picture so far as 8-bit sRGB pixels, keeping its alpha channel only if it has one. */
export async function toRaw(image: Sharp): Promise<RawImage> {
  const { data, info } = await image
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })
  return {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
  }
}

export function fromRaw(raw: RawImage): Sharp {
  const { data, width, height, channels } = raw
  return sharp(data, {
    raw: { width, height, channels: channels as 1 | 2 | 3 | 4 },
  })
}

function scaled(side: number, percent: number): number {
  return Math.max(1, Math.round((side * percent) / PERCENT))
}

async function scaleImage(
  pipeline: Sharp,
  step: Extract<PixelOp, { op: 'scale' }>,
): Promise<Sharp> {
  const raw = await toRaw(pipeline)
  const width = scaled(raw.width, step.percent)
  const height = scaled(raw.height, step.verticalPercent ?? step.percent)
  return fromRaw(raw).resize(width, height, { fit: 'fill' })
}

async function fadeImage(
  pipeline: Sharp,
  step: Extract<PixelOp, { op: 'opacity' }>,
): Promise<Sharp> {
  const raw = await toRaw(pipeline.ensureAlpha())
  const factor = step.percent / PERCENT
  const data = Buffer.from(raw.data)
  for (let at = ALPHA; at < data.length; at += WITH_ALPHA) {
    data[at] = Math.min(MAX_CHANNEL, Math.round((data[at] ?? 0) * factor))
  }
  return fromRaw({ ...raw, data })
}

/** Applies an op that needs the picture's pixels: the picture so far is rendered, changed, and carried on from there. */
export function applyPixelOp(pipeline: Sharp, step: PixelOp): Promise<Sharp> {
  return step.op === 'scale'
    ? scaleImage(pipeline, step)
    : fadeImage(pipeline, step)
}
