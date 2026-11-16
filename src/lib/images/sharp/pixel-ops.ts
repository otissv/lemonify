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

/**
 * The picture rendered without loss and read back as 8-bit sRGB. Reading
 * pixels straight from a pipeline that ends in grey (Greyscale, Extract
 * channel) drops the alpha channel, so the picture goes through a PNG, which
 * keeps it.
 */
async function decoded(image: Sharp): Promise<Sharp> {
  const png = await image.png({ compressionLevel: 0 }).toBuffer()
  return sharp(png).toColourspace('srgb')
}

/** The picture so far as 8-bit sRGB pixels, keeping its alpha channel only if it has one. */
export async function toRaw(image: Sharp): Promise<RawImage> {
  const { data, info } = await (await decoded(image))
    .raw()
    .toBuffer({ resolveWithObject: true })
  return {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
  }
}

/**
 * The picture as 8-bit sRGB pixels with an alpha channel, whatever its bands
 * are: grey becomes colour, a picture without alpha gets a solid one, and
 * when a tool has joined more bands on (Join channel) the first four are the
 * colour and the alpha, as they are when the picture is saved.
 */
export async function toRgba(image: Sharp): Promise<RawImage> {
  const { data, info } = await (await decoded(image))
    .ensureAlpha()
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

type BooleanOp = Extract<SharpOp, { op: 'boolean' }>

/** An operand that is a file to combine with, rather than raw pixels the step describes itself. */
export function isFileBoolean(step: SharpOp): step is BooleanOp {
  return step.op === 'boolean' && step.raw === undefined
}

function withBands(operand: Sharp, channels: number): Sharp {
  switch (channels) {
    case 1:
      return operand.greyscale().removeAlpha()
    case 2:
      return operand.greyscale().ensureAlpha()
    case 3:
      return operand.removeAlpha()
    default:
      return operand.ensureAlpha()
  }
}

/** Sharp wants the operand to have as many bands as the picture, so the file is read with the picture's bands. */
async function combineWithFile(
  picture: RawImage,
  step: BooleanOp,
): Promise<Sharp> {
  const { data, info } = await withBands(
    sharp(step.operand).toColourspace('srgb'),
    picture.channels,
  )
    .raw()
    .toBuffer({ resolveWithObject: true })
  return fromRaw(picture).boolean(data, step.operator, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
}

/** Combines the picture with an image from a file, in the picture's own bands. The alpha channel is left as it is, since it is not colour to combine. */
export async function booleanImage(
  pipeline: Sharp,
  step: BooleanOp,
): Promise<Sharp> {
  const picture = await toRaw(pipeline)
  const alpha = picture.channels === 2 || picture.channels === 4
  if (!alpha) return combineWithFile(picture, step)
  const alphaBand = (picture.channels - 1) as 1 | 3
  const kept = await fromRaw(picture).extractChannel(alphaBand).raw().toBuffer()
  const colour = await toRaw(fromRaw(picture).removeAlpha())
  const combined = await toRaw(await combineWithFile(colour, step))
  return fromRaw(combined).joinChannel(kept, {
    raw: { width: picture.width, height: picture.height, channels: 1 },
  })
}

/** Applies an op that needs the picture's pixels: the picture so far is rendered, changed, and carried on from there. */
export function applyPixelOp(pipeline: Sharp, step: PixelOp): Promise<Sharp> {
  return step.op === 'scale'
    ? scaleImage(pipeline, step)
    : fadeImage(pipeline, step)
}
