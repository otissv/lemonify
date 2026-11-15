import { ERROR_REPORTING, isAppError } from '../errors.ts'
import type { Logger } from './logger.ts'

export const GENERIC_MESSAGE = 'Something went wrong. Try again.'
export const INTERNAL_STATUS = 500

/** The reply every API route sends when something fails, as the project's rules require. */
export type AppResponse<T> = { data: T[]; error: string }

/**
 * What a caller may be told about a failure. A deliberate error carries a
 * message written for people; anything else is logged with its detail and
 * answered in general terms, so no stack trace, path or SQL leaves the server.
 */
export function describeFailure(
  error: unknown,
  logger: Logger,
  context: Record<string, string | number | boolean | null> = {},
): { message: string; status: number } {
  if (isAppError(error)) {
    logger.warn(error.message, { ...context, kind: error.kind })
    return {
      message: error.message,
      status: ERROR_REPORTING[error.kind].httpStatus,
    }
  }
  logger.error(error instanceof Error ? error.message : String(error), {
    ...context,
    stack: error instanceof Error ? (error.stack ?? null) : null,
  })
  return { message: GENERIC_MESSAGE, status: INTERNAL_STATUS }
}

export function errorResponse(
  error: unknown,
  logger: Logger,
  context: Record<string, string | number | boolean | null> = {},
  headers: HeadersInit = {},
): Response {
  const { message, status } = describeFailure(error, logger, context)
  const body: AppResponse<never> = { data: [], error: message }
  return Response.json(body, { status, headers })
}
