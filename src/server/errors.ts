/** Why a request or command failed, in the terms every front door understands. */
export const ErrorKind = {
  Validation: 'validation',
  NotFound: 'not-found',
  Conflict: 'conflict',
  Limit: 'limit',
  Unauthorized: 'unauthorized',
  JobFailed: 'job-failed',
} as const

export type ErrorKind = (typeof ErrorKind)[keyof typeof ErrorKind]

/** How each kind is reported by the website and by the CLI. */
export const ERROR_REPORTING: Record<
  ErrorKind,
  { httpStatus: number; exitCode: number }
> = {
  [ErrorKind.Validation]: { httpStatus: 422, exitCode: 2 },
  [ErrorKind.NotFound]: { httpStatus: 404, exitCode: 3 },
  [ErrorKind.Conflict]: { httpStatus: 409, exitCode: 4 },
  [ErrorKind.Limit]: { httpStatus: 429, exitCode: 5 },
  [ErrorKind.Unauthorized]: { httpStatus: 401, exitCode: 1 },
  [ErrorKind.JobFailed]: { httpStatus: 200, exitCode: 6 },
}

/** Base of every error a service raises on purpose; the message is safe to show. */
export class AppError extends Error {
  readonly kind: ErrorKind

  constructor(kind: ErrorKind, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
    this.kind = kind
  }
}

export class ValidationError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super(ErrorKind.Validation, message, options)
  }
}

/** Also raised for things that belong to another User, so ownership never leaks. */
export class NotFoundError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super(ErrorKind.NotFound, message, options)
  }
}

export class ConflictError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super(ErrorKind.Conflict, message, options)
  }
}

export class LimitError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super(ErrorKind.Limit, message, options)
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Sign in to continue.', options?: ErrorOptions) {
    super(ErrorKind.Unauthorized, message, options)
  }
}

export class JobFailedError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super(ErrorKind.JobFailed, message, options)
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

/** Stored data does not match its schema; reported as unreadable, never converted. */
export class DataIntegrityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DataIntegrityError'
  }
}
