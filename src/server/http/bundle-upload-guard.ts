import { DOCUMENT_FILE_MEDIA_TYPE } from '@/features/documents/document-file'

import { LimitError, ValidationError } from '../errors.ts'

const WRONG_TYPE = 'Send a document file.'
const NO_BODY = 'Send the document file in the body of the request.'
const TOO_LARGE = 'The document file is too large.'

/**
 * Checks an import before anything is stored: it is sent as a zip, it has a
 * body, and it does not declare more than the limit. The body is returned as a
 * stream; the size limit is enforced again while it is read, because a declared
 * length can be wrong or missing.
 */
export function guardBundleUpload(
  request: Request,
  maxBytes: number,
): AsyncIterable<Uint8Array> {
  const type = (request.headers.get('content-type') ?? '')
    .split(';')[0]
    ?.trim()
    .toLowerCase()
  if (type !== DOCUMENT_FILE_MEDIA_TYPE) throw new ValidationError(WRONG_TYPE)
  if (request.body === null) throw new ValidationError(NO_BODY)
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new LimitError(TOO_LARGE)
  }
  return request.body
}
