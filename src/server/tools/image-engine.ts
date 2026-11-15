import { randomUUID } from 'node:crypto'
import { rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import sharp from 'sharp'
import type { Sharp } from 'sharp'

import { ExportFormat } from '@/features/export/export-settings'
import type { ExportSettings } from '@/features/export/export-settings'
import type { SharpStep } from '@/features/pipeline/pipeline'
import { applySharpOpsBlended } from '@/lib/images/sharp/blend-tint'
import { sharpOpSchema } from '@/lib/images/sharp/ops'
import { OUTPUT_OPTION_SCHEMAS } from '@/lib/images/sharp/output-options'

import { RenderError, plainReason } from './render-error.ts'

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
  /** Sharp steps with their second images already resolved to paths. */
  steps: ReadonlyArray<SharpStep>
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
): Sharp {
  const { settings, width } = target
  let next = settings.keepMetadata ? image.keepMetadata() : image
  if (width !== undefined) next = next.resize({ width })
  if (settings.format === ExportFormat.Original) return next
  return next.toFormat(settings.format, exportFormatOptions(settings))
}

function encode(image: Sharp, target: EngineTarget): Sharp {
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
      return encodeExport(image, target)
  }
}

async function build(request: EngineRequest): Promise<Sharp> {
  const image = sharp(request.input).autoOrient()
  const ops = request.steps.map((step) =>
    sharpOpSchema.parse({ ...step.options, op: step.op }),
  )
  return encode(await applySharpOpsBlended(image, ops), request.target)
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
