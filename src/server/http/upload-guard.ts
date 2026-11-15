import { LimitError, ValidationError } from '../errors.ts'
import { SOURCE_MEDIA_TYPES } from '../tools/image-inspector.ts'
import type { SourceMediaType } from '../tools/image-inspector.ts'

export const FILE_NAME_HEADER = 'x-file-name'

const MAX_FILE_NAME_LENGTH = 255
const MAGIC_BYTES_NEEDED = 12
const WRONG_TYPE = `Use one of: ${SOURCE_MEDIA_TYPES.join(', ')}.`
const NOT_THE_DECLARED_TYPE =
  'That file is not the kind of image its type says it is.'
const TOO_LARGE = 'The image is too large.'
const NO_BODY = 'Send the image in the body of the request.'
const NO_NAME = 'Send the image name in the X-File-Name header.'

function startsWith(
  bytes: Uint8Array,
  expected: ReadonlyArray<number>,
  at = 0,
) {
  return expected.every((value, index) => bytes[at + index] === value)
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG = [0xff, 0xd8, 0xff]
const GIF = [0x47, 0x49, 0x46, 0x38]
const RIFF = [0x52, 0x49, 0x46, 0x46]
const WEBP = [0x57, 0x45, 0x42, 0x50]
const FTYP = [0x66, 0x74, 0x79, 0x70]
const AVIF_BRANDS = [
  [0x61, 0x76, 0x69, 0x66],
  [0x61, 0x76, 0x69, 0x73],
]

/** The image type a file's first bytes say it is, or undefined when they match none the app takes. */
export function sniffMediaType(head: Uint8Array): SourceMediaType | undefined {
  if (startsWith(head, PNG)) return 'image/png'
  if (startsWith(head, JPEG)) return 'image/jpeg'
  if (startsWith(head, GIF)) return 'image/gif'
  if (startsWith(head, RIFF) && startsWith(head, WEBP, 8)) return 'image/webp'
  if (
    startsWith(head, FTYP, 4) &&
    AVIF_BRANDS.some((brand) => startsWith(head, brand, 8))
  ) {
    return 'image/avif'
  }
  return undefined
}

function isSourceMediaType(value: string): value is SourceMediaType {
  return SOURCE_MEDIA_TYPES.some((type) => type === value)
}

function declaredType(request: Request): SourceMediaType {
  const header = request.headers.get('content-type') ?? ''
  const type = header.split(';')[0]?.trim().toLowerCase() ?? ''
  if (!isSourceMediaType(type)) throw new ValidationError(WRONG_TYPE)
  return type
}

function declaredName(request: Request): string {
  const raw = request.headers.get(FILE_NAME_HEADER)
  if (raw === null || raw.trim() === '') throw new ValidationError(NO_NAME)
  let name: string
  try {
    name = decodeURIComponent(raw)
  } catch {
    throw new ValidationError(NO_NAME)
  }
  if (name.length > MAX_FILE_NAME_LENGTH) {
    throw new ValidationError(NO_NAME)
  }
  return name
}

function declaredLength(request: Request, maxBytes: number): void {
  const header = request.headers.get('content-length')
  if (header === null) return
  const length = Number(header)
  if (Number.isFinite(length) && length > maxBytes) {
    throw new LimitError(TOO_LARGE)
  }
}

async function* checked(
  stream: ReadableStream<Uint8Array>,
  expected: SourceMediaType,
): AsyncGenerator<Uint8Array> {
  let head = new Uint8Array(0)
  let verified = false
  for await (const chunk of stream) {
    if (!verified) {
      const joined = new Uint8Array(head.length + chunk.length)
      joined.set(head)
      joined.set(chunk, head.length)
      head = joined
      if (head.length < MAGIC_BYTES_NEEDED) continue
      if (sniffMediaType(head) !== expected) {
        throw new ValidationError(NOT_THE_DECLARED_TYPE)
      }
      verified = true
      yield head
      continue
    }
    yield chunk
  }
  if (!verified) {
    if (sniffMediaType(head) !== expected) {
      throw new ValidationError(NOT_THE_DECLARED_TYPE)
    }
    yield head
  }
}

export type GuardedUpload = {
  fileName: string
  body: AsyncIterable<Uint8Array>
}

/**
 * Checks an upload before anything is stored: the declared type is one the app
 * takes, the declared size is within the limit, a name was sent, and the first
 * bytes of the body really are that type. The body is returned as a stream the
 * store reads, so the file is never held in memory and a type mismatch stops
 * it after the first chunk. The size limit is enforced again by the store while
 * it reads, because a declared length can be wrong or missing.
 */
export function guardUpload(request: Request, maxBytes: number): GuardedUpload {
  const type = declaredType(request)
  const fileName = declaredName(request)
  declaredLength(request, maxBytes)
  if (request.body === null) throw new ValidationError(NO_BODY)
  return { fileName, body: checked(request.body, type) }
}
