import { randomUUID } from 'node:crypto'
import { rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import sharp from 'sharp'
import type { Sharp } from 'sharp'

import { ExportFormat } from '@/features/export/export-settings'
import type { ExportSettings } from '@/features/export/export-settings'
import type { SharpStep } from '@/features/pipeline/pipeline'
import type { StepBlend } from '@/features/pipeline/step-blend'
import { applySharpOpsBlended } from '@/lib/images/sharp/blend-tint'
import { toRgba } from '@/lib/images/sharp/pixel-ops'
import { applySharpOps, sharpOpSchema } from '@/lib/images/sharp/ops'
import type { SharpOp } from '@/lib/images/sharp/ops'
import { OUTPUT_OPTION_SCHEMAS } from '@/lib/images/sharp/output-options'

import { blendPictures, compositeLayer } from './layer-compositor.ts'
import type { EngineLayer, RawImage } from './layer-compositor.ts'
import { RenderError, plainReason } from './render-error.ts'

export type { EngineLayer } from './layer-compositor.ts'

/** One thing the engine does to the picture: a Sharp step, or a layer placed over it. */
export type EngineStep = SharpStep | EngineLayer

const WHITE = '#ffffff'
const CHANNELS = 4

/** The longest side of a preview; images are shown no larger, whatever their real size. */
export const PREVIEW_MAX_SIZE = 2560
export const THUMBNAIL_MAX_SIZE = 96
const PREVIEW_QUALITY = 92
const THUMBNAIL_QUALITY = 80

export enum EngineTargetKind {
  Preview = 'preview',
  Thumbnail = 'thumbnail',
  /** A lossless PNG that another step reads next. */
  Intermediate = 'intermediate',
  Export = 'export',
}

export type EngineTarget =
  | { kind: EngineTargetKind.Preview }
  | { kind: EngineTargetKind.Thumbnail }
  | { kind: EngineTargetKind.Intermediate }
  | {
      kind: EngineTargetKind.Export
      settings: ExportSettings
      /** Shrink or grow to this width, keeping the proportions. */
      width?: number
    }

export interface EngineRequest {
  /** The image the steps start from. */
  input: string
  /** Sharp steps and layers, in order, with every image they use already resolved to a path. */
  steps: ReadonlyArray<EngineStep>
  target: EngineTarget
  /** Exactly where to write the image. */
  output: string
}

export interface EngineOutput {
  width: number
  height: number
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
  savesAsJpeg: boolean,
): Sharp {
  const { settings, width } = target
  let next = settings.keepMetadata ? image.keepMetadata() : image
  if (width !== undefined) next = next.resize({ width })
  if (settings.format === ExportFormat.Original) {
    return savesAsJpeg ? next.flatten({ background: WHITE }) : next
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
  savesAsJpeg: boolean,
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
    case EngineTargetKind.Intermediate:
      return image.png()
    case EngineTargetKind.Export:
      return encodeExport(image, target, savesAsJpeg)
  }
}

async function pixelsOf(image: Sharp): Promise<RawImage> {
  const { data, width, height } = await toRgba(image)
  return { data, width, height }
}

function fromPixels(image: RawImage): Sharp {
  return sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: CHANNELS },
  })
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
    if (step.kind === 'layer') {
      pipeline = await applySharpOpsBlended(pipeline, stage, 'pixels')
      stage = []
      pipeline = fromPixels(
        await compositeLayer(await pixelsOf(pipeline), step),
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
      return true
    case EngineTargetKind.Export:
      return target.width !== undefined
    case EngineTargetKind.Intermediate:
      return false
  }
}

async function build(request: EngineRequest): Promise<Sharp> {
  const image = sharp(request.input).autoOrient()
  const savesAsJpeg =
    request.target.kind === EngineTargetKind.Export &&
    (await sharp(request.input).metadata()).format === 'jpeg'
  let picture = await applySteps(image, request.steps)
  if (request.steps.length > 0 && sizesThePicture(request.target)) {
    // Sharp keeps one resize per pipeline, and a second one replaces the
    // first, so the steps' picture is made before it is sized.
    picture = fromPixels(await pixelsOf(picture))
  }
  return encode(picture, request.target, savesAsJpeg)
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
      const { data, info } = await (await build(request)).toBuffer({
        resolveWithObject: true,
      })
      await writeFile(partial, data)
      await rename(partial, request.output)
      return {
        width: info.width,
        height: info.height,
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
