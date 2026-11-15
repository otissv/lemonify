import { errorMessage } from '@/lib/error-message'

const ABSOLUTE_PATH = /(?:[A-Za-z]:)?(?:[\\/][^\s:'"`,;()]+)+/g

/** A failure in image work. The message is plain words; the cause keeps the detail for the log. */
export class RenderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'RenderError'
  }
}

/** The reason in a caught error, with any file path in it removed. */
export function plainReason(error: unknown): string {
  return errorMessage(error, 'unknown error').replace(
    ABSOLUTE_PATH,
    'the image',
  )
}
