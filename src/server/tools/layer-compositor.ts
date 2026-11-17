import sharp from 'sharp'

import type { LayerBlend, LayerSettings } from '@/features/pipeline/layer'
import { isDefaultBlend } from '@/features/pipeline/step-blend'
import type { StepBlend } from '@/features/pipeline/step-blend'

import {
  layerPlacement,
  layerSize,
  visibleRegion,
} from '../render/layer-geometry.ts'

const CHANNELS = 4
const ALPHA = 3
const PERCENT = 100
const FULL_TURN = 360
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 }

/** 8-bit RGBA pixels, rows from the top, alpha not premultiplied. */
export interface RawImage {
  data: Buffer
  width: number
  height: number
}

/** A layer with its image resolved to a file. */
export interface EngineLayer extends LayerSettings {
  kind: 'layer'
  path: string
}

async function decode(file: string): Promise<RawImage> {
  const { data, info } = await sharp(file)
    .autoOrient()
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

async function place(
  image: RawImage,
  width: number,
  height: number,
  rotation: number,
): Promise<RawImage> {
  let pipeline = sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: CHANNELS },
  }).resize(width, height, { fit: 'fill' })
  if (rotation % FULL_TURN !== 0) {
    pipeline = pipeline.rotate(rotation, { background: TRANSPARENT })
  }
  const { data, info } = await pipeline
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

async function crop(
  image: RawImage,
  region: { left: number; top: number; width: number; height: number },
): Promise<RawImage> {
  const { data, info } = await sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: CHANNELS },
  })
    .extract(region)
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

/** Multiplies every pixel's alpha by `opacity` (a percentage); the colours are untouched. */
function fade(image: RawImage, opacity: number): void {
  if (opacity >= PERCENT) return
  const factor = opacity / PERCENT
  for (let at = ALPHA; at < image.data.length; at += CHANNELS) {
    image.data[at] = Math.round((image.data[at] ?? 0) * factor)
  }
}

async function composeOnto(
  canvas: RawImage,
  part: RawImage,
  at: { left: number; top: number },
  blend: LayerBlend,
): Promise<RawImage> {
  const { data, info } = await sharp(canvas.data, {
    raw: { width: canvas.width, height: canvas.height, channels: CHANNELS },
  })
    .composite([
      {
        input: part.data,
        raw: { width: part.width, height: part.height, channels: CHANNELS },
        left: at.left,
        top: at.top,
        blend: blend === 'normal' ? 'over' : blend,
      },
    ])
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

/**
 * Puts the result of a step over the picture as it was before the step, with a
 * blend mode and an opacity. The two are the same size. With the defaults,
 * normal and 100, the result simply replaces the picture.
 */
export async function blendPictures(
  before: RawImage,
  after: RawImage,
  blend: StepBlend,
): Promise<RawImage> {
  if (before.width !== after.width || before.height !== after.height) {
    throw new RangeError(
      'A blend needs a step that keeps the size of the picture.',
    )
  }
  if (isDefaultBlend(blend)) return after
  const faded = { ...after, data: Buffer.from(after.data) }
  fade(faded, blend.opacity)
  return composeOnto(before, faded, { left: 0, top: 0 }, blend.mode)
}

/**
 * Puts a layer over the canvas and answers with the new picture, which is the
 * size of the canvas: what hangs over its edge is cut off. The layer's image
 * is oriented, sized by its fit and scale, turned, faded and then blended by
 * its alpha and blend mode, so transparent parts show what is under them.
 */
export async function compositeLayer(
  canvas: RawImage,
  layer: EngineLayer,
): Promise<RawImage> {
  return compositeImage(canvas, await decode(layer.path), layer)
}

/** The same for a picture that is already made, such as a sub-document's: put over the canvas with a layer's placement settings. */
export async function compositeImage(
  canvas: RawImage,
  image: RawImage,
  layer: LayerSettings,
): Promise<RawImage> {
  const size = layerSize(canvas, image, layer.fit, layer.scale)
  const placed = await place(image, size.width, size.height, layer.rotation)
  const at = layerPlacement(canvas, placed, layer.anchor, layer.x, layer.y)
  const visible = visibleRegion(canvas, placed, at.left, at.top)
  if (visible === undefined) return canvas
  const part = await crop(placed, visible.crop)
  fade(part, layer.opacity)
  return composeOnto(canvas, part, visible.at, layer.blend)
}
