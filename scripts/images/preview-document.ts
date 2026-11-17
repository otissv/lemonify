import { stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'

import sharp from 'sharp'

import { JobKind } from '../../src/server/jobs/job-types.ts'
import { RenderKind } from '../../src/server/tools/render-store.ts'
import type { App } from '../../src/server/composition.ts'
import type { Actor } from '../../src/server/domain/actor.ts'
import { ValidationError } from '../../src/server/errors.ts'
import { cropBox } from './region.ts'
import type { Region } from './region.ts'
import { writeAtomically } from './save-result.ts'

export type PreviewOptions = {
  /** The image as opened, before any step, as the editor's "show original" does. */
  original?: boolean
  /** Only this part of the picture, taken before it is shrunk. */
  region?: Region
  /** Shrink the picture to this width; it is never made larger. */
  width?: number
}

export type PreviewPicture = {
  path: string
  bytes: number
  format: PictureFormat
  original: boolean
  /** The part of the picture that was written, or null for all of it. */
  region: Region | null
  /** AI steps still waiting for a result; the picture shows the pipeline only up to the first. */
  pending: string[]
  /** Steps left out of the picture, with why. */
  problems: Array<{ stepId: string; message: string }>
}

const PICTURE_FORMATS = {
  '.webp': 'webp',
  '.png': 'png',
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
} as const

type PictureFormat = (typeof PICTURE_FORMATS)[keyof typeof PICTURE_FORMATS]

/** The preview is made as WebP, so that is what is written when nothing asks otherwise. */
const NATIVE_FORMAT: PictureFormat = 'webp'
const NAME_UNSAFE = /[\\/:*?"<>|\0]/g

function formatFor(destination: string): PictureFormat | undefined {
  const extension = path.extname(destination).toLowerCase()
  if (extension === '') return undefined
  const format = (PICTURE_FORMATS as Record<string, PictureFormat>)[extension]
  if (format === undefined) {
    throw new ValidationError(
      `Write the picture as ${Object.keys(PICTURE_FORMATS).join(', ')}.`,
    )
  }
  return format
}

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

async function renderedPicture(
  app: App,
  actor: Actor,
  documentId: string,
): Promise<{
  stream: Readable
  pending: string[]
  problems: PreviewPicture['problems']
}> {
  const queued = await app.renders.requestPreview(actor, documentId)
  const done = await app.jobs.waitFor(actor, queued.id)
  if (done.result?.kind !== JobKind.Preview) {
    throw new Error('The preview finished without a result.')
  }
  const opened = await app.renders.fetch(
    actor,
    documentId,
    RenderKind.Preview,
    done.result.key,
  )
  return {
    stream: opened.stream,
    pending: done.result.pendingStepIds,
    problems: done.result.problems,
  }
}

async function originalPicture(
  app: App,
  actor: Actor,
  documentId: string,
): Promise<Readable> {
  const document = await app.documents.get(actor, documentId)
  if (document.source === null) {
    throw new ValidationError('This document has no image.')
  }
  return (await app.sources.open(actor, document.source.id)).stream
}

/**
 * Writes the picture the canvas shows to `destination`, which is the CLI's
 * version of looking at it. The picture is made by the same preview the editor
 * asks for, so what is seen here is what the person sees on the page. The type
 * of file follows the extension. The caller must have Job workers running.
 */
export async function writePreview(
  app: App,
  actor: Actor,
  documentId: string,
  destination: string,
  options: PreviewOptions = {},
): Promise<PreviewPicture> {
  const format = formatFor(destination)
  const original = options.original === true
  const picture = original
    ? {
        stream: await originalPicture(app, actor, documentId),
        pending: [],
        problems: [],
      }
    : await renderedPicture(app, actor, documentId)

  const wanted = format ?? NATIVE_FORMAT
  const unchanged =
    !original &&
    wanted === NATIVE_FORMAT &&
    options.width === undefined &&
    options.region === undefined
  let content: Readable = picture.stream
  if (!unchanged) {
    let image = sharp(await collect(picture.stream))
    if (options.region !== undefined) {
      const { width, height } = await image.metadata()
      if (width === undefined || height === undefined) {
        throw new Error('The picture has no size to take a region of.')
      }
      image = sharp(await image.toBuffer()).extract(
        cropBox(options.region, width, height),
      )
    }
    if (options.width !== undefined) {
      image = image.resize({ width: options.width, withoutEnlargement: true })
    }
    content = Readable.from(await image.toFormat(wanted).toBuffer())
  }

  const name = (await app.documents.get(actor, documentId)).name
  const written = await writeAtomically(
    destination,
    `${name.replace(NAME_UNSAFE, '_')}.${wanted === 'jpeg' ? 'jpg' : wanted}`,
    content,
  )
  const { size } = await stat(written)
  return {
    path: written,
    bytes: size,
    format: wanted,
    original,
    region: options.region ?? null,
    pending: picture.pending,
    problems: picture.problems,
  }
}
