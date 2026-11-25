import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'

import { ZipWriter } from '../bundle/zip.ts'
import type { Actor } from '../domain/actor.ts'
import { ValidationError } from '../errors.ts'
import type { ResultService } from '../services/result-service.ts'
import type { RunOutput } from '../services/workflow-service.ts'

export const RUN_ARCHIVE_MEDIA_TYPE = 'application/zip'

const NOTHING_FINISHED = 'This run has no finished images to download yet.'
const IMAGE_GONE = 'An image this run made is no longer stored.'
const TOO_BIG = 'The run’s images are too large to put in one zip file.'
const UNSAFE_NAME_CHARACTERS = /[\\/:*?"<>|]/g
const FIRST_PRINTABLE = 0x20

function withoutControlCharacters(name: string): string {
  let kept = ''
  for (const character of name) {
    kept += (character.codePointAt(0) ?? 0) < FIRST_PRINTABLE ? '-' : character
  }
  return kept
}

/** What was written: the file name to offer, its size and how many images it holds. */
export type WrittenRunArchive = {
  fileName: string
  bytes: number
  images: number
}

export type OpenedRunArchive = {
  stream: Readable
  fileName: string
  bytes: number
  mediaType: string
}

/** The file name a run's zip is offered under: the workflow's name, or the run's when the workflow is gone. */
export function runArchiveName(
  workflowName: string | undefined,
  runId: string,
): string {
  const fallback = `run-${runId}`
  const base = withoutControlCharacters(workflowName ?? fallback)
    .replace(UNSAFE_NAME_CHARACTERS, '-')
    .trim()
  return `${base === '' ? fallback : base}.zip`
}

/** `name`, or the first of `name-1`, `name-2`… not yet used, so two images of the same name both fit in the zip. */
function uniqueName(name: string, used: Set<string>): string {
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ''
  let candidate = name
  for (let count = 1; used.has(candidate); count += 1) {
    candidate = `${stem}-${count}${extension}`
  }
  used.add(candidate)
  return candidate
}

/**
 * Writes every finished image of a run into one zip file at `destination`,
 * in the order of the run's outputs. Images are stored as they are, since
 * they are already compressed. Refuses a run with nothing finished.
 */
export async function writeRunArchive(
  results: ResultService,
  actor: Actor,
  outputs: ReadonlyArray<RunOutput>,
  destination: string,
  fileName: string,
): Promise<WrittenRunArchive> {
  const images = outputs.flatMap((output) => output.images)
  if (images.length === 0) throw new ValidationError(NOTHING_FINISHED)
  const writer = await ZipWriter.create(destination, TOO_BIG)
  try {
    const used = new Set<string>()
    for (const image of images) {
      const record = await results.get(actor, image.resultId)
      const file = await results.findPath(record.ownerId, record.key)
      if (file === undefined) throw new ValidationError(IMAGE_GONE)
      await writer.addFile(uniqueName(record.fileName, used), file)
    }
    await writer.close()
  } catch (error) {
    await writer.abort()
    throw error
  }
  const { size } = await stat(destination)
  return { fileName, bytes: size, images: images.length }
}

/** Writes a run's zip into a folder of its own under `workRoot` and opens it; the folder goes when the stream closes. */
export async function openRunArchive(
  workRoot: string,
  write: (destination: string) => Promise<WrittenRunArchive>,
): Promise<OpenedRunArchive> {
  await mkdir(workRoot, { recursive: true })
  const directory = await mkdtemp(path.join(workRoot, 'run-archive-'))
  try {
    const destination = path.join(directory, 'archive.zip')
    const written = await write(destination)
    const stream = createReadStream(destination)
    stream.once('close', () => {
      void rm(directory, { recursive: true, force: true })
    })
    return {
      stream,
      fileName: written.fileName,
      bytes: written.bytes,
      mediaType: RUN_ARCHIVE_MEDIA_TYPE,
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}
