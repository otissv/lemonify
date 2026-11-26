import { randomUUID } from 'node:crypto'
import { rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import sharp from 'sharp'
import type { FormatEnum, Sharp } from 'sharp'

import { ExportFormat } from '@/features/export/export-settings'
import type { ExportSettings } from '@/features/export/export-settings'
import { parseBackground } from '@/features/pipeline/canvas'
import type { Canvas } from '@/features/pipeline/canvas'
import type { SharpStep } from '@/features/pipeline/pipeline'
import type { StepBlend } from '@/features/pipeline/step-blend'
import { applySharpOpsBlended } from '@/lib/images/sharp/blend-tint'
import { toRgba } from '@/lib/images/sharp/pixel-ops'
import { applySharpOps, sharpOpSchema } from '@/lib/images/sharp/ops'
import type { SharpOp } from '@/lib/images/sharp/ops'
import { OUTPUT_OPTION_SCHEMAS } from '@/lib/images/sharp/output-options'

import {
  blendPictures,
  compositeImage,
  compositeLayer,
} from './layer-compositor.ts'
import type { EngineLayer, RawImage } from './layer-compositor.ts'
import type { LayerSettings } from '@/features/pipeline/layer'
import { RenderError, plainReason } from './render-error.ts'

export type { EngineLayer } from './layer-compositor.ts'

/**
 * A picture of its own, placed over the canvas like a layer: `steps` act on
 * the image at `input` only, and the result is drawn with the layer settings.
 */
export interface EngineEmbeddedDocument extends LayerSettings {
  kind: 'embedded-document'
  input: EngineBase
  steps: ReadonlyArray<EngineStep>
}

/** What a picture starts from: an image file, or a blank canvas. */
export type EngineBase =
  | { kind: 'file'; path: string }
  | { kind: 'canvas'; canvas: Canvas }

/** One thing the engine does to the picture: a Sharp step, a layer placed over it, or an embedded document layer placed over it. */
export type EngineStep = SharpStep | EngineLayer | EngineEmbeddedDocument

const WHITE = '#ffffff'
const CHANNELS = 4

/** The longest side of a preview; images are shown no larger, whatever their real size. */
export const PREVIEW_MAX_SIZE = 2560
/** Document step list: shown at 48 px; 96 px is enough at 2×. */
export const THUMBNAIL_MAX_SIZE = 96
/** Workflow diagram node: ~176 px content width at 2× (see `step-node.tsx`). */
export const WORKFLOW_NODE_THUMBNAIL_MAX_SIZE = 384
const PREVIEW_QUALITY = 92
const THUMBNAIL_QUALITY = 80

export enum EngineTargetKind {
  Preview = 'preview',
  Thumbnail = 'thumbnail',
  WorkflowNode = 'workflow-node',
  /** A lossless PNG that another step reads next. */
  Intermediate = 'intermediate',
  Export = 'export',
}

export type EngineTarget =
  | { kind: EngineTargetKind.Preview }
  | { kind: EngineTargetKind.Thumbnail }
  | { kind: EngineTargetKind.WorkflowNode }
  | { kind: EngineTargetKind.Intermediate }
  | {
      kind: EngineTargetKind.Export
      settings: ExportSettings
      /** Shrink or grow to this width, keeping the proportions. */
      width?: number
    }

export interface EngineRequest {
  /** What the steps start from. */
  input: EngineBase
  /** Sharp steps and layers, in order, with every image they use already resolved to a path. */
  steps: ReadonlyArray<EngineStep>
  target: EngineTarget
  /** Exactly where to write the image. */
  output: string
  /** The image whose format an export "same as original" keeps; a PNG when there is none or its format cannot be written. */
  originalFrom?: string
}

export interface EngineOutput {
  width: number
  height: number
  /** The size of the picture the steps made, before a preview or thumbnail shrank it; the same as `width` and `height` when nothing shrank it. */
  pictureWidth: number
  pictureHeight: number
  bytes: number
  /** The format Sharp actually wrote, such as `webp` or `jpeg`. */
  format: string
}

/** Applies Sharp steps to an image and writes the result. One implementation exists; tests use fakes. */
export interface ImageEngine {
  render(request: EngineRequest): Promise<EngineOutput>
}

function describeIssues(
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
): string {
  const parts: Array<string> = []
  for (const issue of issues) {
    const field = issue.path.map(String).join('.')
    parts.push(field ? `${field}: ${issue.message}` : issue.message)
  }
  return parts.join('; ')
}

/** The format's options, checked against the image CLI's own schema for it. */
export function exportFormatOptions(
  settings: ExportSettings,
): Record<string, unknown> {
  if (settings.format === ExportFormat.Original) return {}
  const parsed = OUTPUT_OPTION_SCHEMAS[settings.format].safeParse(
    settings.options,
  )
  if (parsed.success) return parsed.data
  throw new RenderError(
    `The export options are not valid: ${describeIssues(parsed.error.issues)}`,
  )
}

function fitInside(image: Sharp, size: number): Sharp {
  return image.resize({
    width: size,
    height: size,
    fit: 'inside',
    withoutEnlargement: true,
  })
}

function encodeExport(
  image: Sharp,
  target: Extract<EngineTarget, { kind: EngineTargetKind.Export }>,
  original: OriginalFormat,
): Sharp {
  const { settings, width } = target
  let next = settings.keepMetadata ? image.keepMetadata() : image
  if (width !== undefined) next = next.resize({ width })
  if (settings.format === ExportFormat.Original) {
    const kept = next.toFormat(original.format, original.options)
    return original.format === ExportFormat.Jpeg
      ? kept.flatten({ background: WHITE })
      : kept
  }
  const converted = next.toFormat(
    settings.format,
    exportFormatOptions(settings),
  )
  return settings.format === ExportFormat.Jpeg
    ? converted.flatten({ background: WHITE })
    : converted
}

function encode(
  image: Sharp,
  target: EngineTarget,
  original: OriginalFormat,
): Sharp {
  switch (target.kind) {
    case EngineTargetKind.Preview:
      return fitInside(image, PREVIEW_MAX_SIZE).webp({
        quality: PREVIEW_QUALITY,
      })
    case EngineTargetKind.Thumbnail:
      return fitInside(image, THUMBNAIL_MAX_SIZE).webp({
        quality: THUMBNAIL_QUALITY,
      })
    case EngineTargetKind.WorkflowNode:
      return fitInside(image, WORKFLOW_NODE_THUMBNAIL_MAX_SIZE).webp({
        quality: THUMBNAIL_QUALITY,
      })
    case EngineTargetKind.Intermediate:
      return image.png()
    case EngineTargetKind.Export:
      return encodeExport(image, target, original)
  }
}

const FALLBACK_FORMAT = 'png'

/** The picture a render starts from. */
function baseImage(base: EngineBase): Sharp {
  if (base.kind === 'file') return sharp(base.path).autoOrient()
  const { width, height, background } = base.canvas
  const colour = parseBackground(background)
  return sharp({
    create: {
      width,
      height,
      channels: colour.alpha === 1 ? OPAQUE_CHANNELS : CHANNELS,
      background: colour,
    },
  })
}

/** The format "same as original" writes, with what it needs to write that file the same way. */
type OriginalFormat = {
  format: keyof FormatEnum
  options: Record<string, unknown>
}

const FALLBACK_ORIGINAL: OriginalFormat = {
  format: FALLBACK_FORMAT,
  options: {},
}

function isWritableFormat(format: string): format is keyof FormatEnum {
  return sharp.format[format as keyof FormatEnum]?.output.buffer === true
}

/**
 * The format of the image an export follows, when Sharp can write it, else
 * PNG. Sharp reads AVIF and HEIC both as `heif` and tells them apart by the
 * compression, which it must be given back to write the same kind of file.
 */
async function originalFormat(
  from: string | undefined,
): Promise<OriginalFormat> {
  if (from === undefined) return FALLBACK_ORIGINAL
  const { format, compression } = await sharp(from).metadata()
  if (format === undefined || !isWritableFormat(format)) {
    return FALLBACK_ORIGINAL
  }
  if (format === 'heif') return { format, options: { compression } }
  return { format, options: {} }
}

async function pixelsOf(image: Sharp): Promise<RawImage> {
  const { data, width, height } = await toRgba(image)
  return { data, width, height }
}

const OPAQUE_CHANNELS = 3
const OPAQUE_ALPHA = 255

function isOpaque(image: RawImage): boolean {
  for (let index = CHANNELS - 1; index < image.data.length; index += CHANNELS) {
    if (image.data[index] !== OPAQUE_ALPHA) return false
  }
  return true
}

/**
 * The picture made from RGBA pixels, without its alpha when every pixel is
 * opaque. The steps after it then see what an opaque image file gives them:
 * a step that adds an alpha (ensure alpha, join channel) takes effect, and one
 * that works on every band (convolve, bandbool) leaves the alpha alone.
 */
function fromPixels(image: RawImage): Sharp {
  const { width, height } = image
  if (!isOpaque(image)) {
    return sharp(image.data, { raw: { width, height, channels: CHANNELS } })
  }
  return sharp(withoutAlpha(image.data), {
    raw: { width, height, channels: OPAQUE_CHANNELS },
  })
}

/** The colour bytes of RGBA pixels. Sharp's own `removeAlpha` runs after the other operations, so the steps would still see the alpha. */
function withoutAlpha(rgba: Buffer): Buffer {
  const rgb = Buffer.alloc((rgba.length / CHANNELS) * OPAQUE_CHANNELS)
  let to = 0
  for (let from = 0; from < rgba.length; from += CHANNELS) {
    rgba.copy(rgb, to, from, from + OPAQUE_CHANNELS)
    to += OPAQUE_CHANNELS
  }
  return rgb
}

/** The picture with one step applied and its result blended over the picture as it was. */
async function blended(
  image: Sharp,
  op: SharpOp,
  blend: StepBlend,
): Promise<Sharp> {
  const before = await pixelsOf(image)
  const after = await pixelsOf(
    await applySharpOpsBlended(fromPixels(before), [op], 'pixels'),
  )
  return fromPixels(await blendPictures(before, after, blend))
}

/** An embedded document layer's own picture: its image with its own steps applied, at its own size. Embedded document layers inside it are made the same way. */
async function embeddedPicture(
  step: EngineEmbeddedDocument,
): Promise<RawImage> {
  return pixelsOf(await applySteps(baseImage(step.input), step.steps))
}

/**
 * Applies the steps in order. Sharp does not run the operations of one
 * pipeline in the order they are listed (it resizes before it composites, for
 * instance), so the picture is rendered to pixels at every layer and the next
 * stage starts from those pixels: a step before a layer acts on the picture
 * only, and a step after it acts on the layer too.
 */
async function applySteps(
  image: Sharp,
  steps: ReadonlyArray<EngineStep>,
): Promise<Sharp> {
  let pipeline = image
  let stage: SharpOp[] = []
  const all: SharpOp[] = []
  for (const step of steps) {
    if (step.kind === 'layer' || step.kind === 'embedded-document') {
      pipeline = await applySharpOpsBlended(pipeline, stage, 'pixels')
      stage = []
      const canvas = await pixelsOf(pipeline)
      pipeline = fromPixels(
        step.kind === 'layer'
          ? await compositeLayer(canvas, step)
          : await compositeImage(canvas, await embeddedPicture(step), step),
      )
      continue
    }
    const op = sharpOpSchema.parse({ ...step.options, op: step.op })
    all.push(op)
    if (step.blend !== undefined) {
      pipeline = await applySharpOpsBlended(pipeline, stage, 'pixels')
      stage = []
      pipeline = await blended(pipeline, op, step.blend)
      continue
    }
    stage.push(op)
  }
  pipeline = await applySharpOpsBlended(pipeline, stage, 'pixels')
  return applySharpOps(pipeline, all, 'output')
}

/** Whether the target sizes the picture itself, after the steps have made it. */
function sizesThePicture(target: EngineTarget): boolean {
  switch (target.kind) {
    case EngineTargetKind.Preview:
    case EngineTargetKind.Thumbnail:
    case EngineTargetKind.WorkflowNode:
      return true
    case EngineTargetKind.Export:
      return target.width !== undefined
    case EngineTargetKind.Intermediate:
      return false
  }
}

interface Built {
  image: Sharp
  /** The picture the steps made, before it was sized; undefined when the target does not size it. */
  picture: { width: number; height: number } | undefined
}

async function build(request: EngineRequest): Promise<Built> {
  const original = await originalFormat(request.originalFrom)
  const picture = await applySteps(baseImage(request.input), request.steps)
  if (!sizesThePicture(request.target)) {
    return {
      image: encode(picture, request.target, original),
      picture: undefined,
    }
  }
  // Sharp keeps one resize per pipeline, and a second one replaces the
  // first, so the steps' picture is made before it is sized. Its size is read
  // from the pixels, since a file's own header ignores the orientation.
  const pixels = await pixelsOf(picture)
  return {
    image: encode(fromPixels(pixels), request.target, original),
    picture: { width: pixels.width, height: pixels.height },
  }
}

/**
 * Sharp-backed image work. The image is encoded in memory and written beside
 * its destination, then renamed into place, so a failure never leaves half a
 * file and an image can be written over the one it was read from.
 */
export class SharpImageEngine implements ImageEngine {
  async render(request: EngineRequest): Promise<EngineOutput> {
    const partial = path.join(
      path.dirname(request.output),
      `.${randomUUID()}.partial-${path.basename(request.output)}`,
    )
    try {
      const built = await build(request)
      const { data, info } = await built.image.toBuffer({
        resolveWithObject: true,
      })
      await writeFile(partial, data)
      await rename(partial, request.output)
      return {
        width: info.width,
        height: info.height,
        pictureWidth: built.picture?.width ?? info.width,
        pictureHeight: built.picture?.height ?? info.height,
        bytes: info.size,
        format: info.format,
      }
    } catch (error) {
      await rm(partial, { force: true })
      if (error instanceof RenderError) throw error
      throw new RenderError(
        `The image could not be rendered: ${plainReason(error)}`,
        { cause: error },
      )
    }
  }
}
