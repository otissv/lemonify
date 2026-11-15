import { describe, expect, it } from 'vitest'

import {
  type AppError,
  ConflictError,
  ERROR_REPORTING,
  ErrorKind,
  JobFailedError,
  LimitError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  isAppError,
} from './errors'

describe('errors', () => {
  it('reports each kind with the status and exit code from the plan', () => {
    expect(ERROR_REPORTING[ErrorKind.Validation]).toEqual({
      httpStatus: 422,
      exitCode: 2,
    })
    expect(ERROR_REPORTING[ErrorKind.NotFound]).toEqual({
      httpStatus: 404,
      exitCode: 3,
    })
    expect(ERROR_REPORTING[ErrorKind.Conflict]).toEqual({
      httpStatus: 409,
      exitCode: 4,
    })
    expect(ERROR_REPORTING[ErrorKind.Limit]).toEqual({
      httpStatus: 429,
      exitCode: 5,
    })
    expect(ERROR_REPORTING[ErrorKind.Unauthorized].httpStatus).toBe(401)
    expect(ERROR_REPORTING[ErrorKind.JobFailed].exitCode).toBe(6)
  })

  it('keeps the class name, kind and message', () => {
    const cases: Array<[AppError, string]> = [
      [new ValidationError('bad'), ErrorKind.Validation],
      [new NotFoundError('missing'), ErrorKind.NotFound],
      [new ConflictError('stale'), ErrorKind.Conflict],
      [new LimitError('too many'), ErrorKind.Limit],
      [new UnauthorizedError(), ErrorKind.Unauthorized],
      [new JobFailedError('failed'), ErrorKind.JobFailed],
    ]
    for (const [error, kind] of cases) {
      expect(error.kind).toBe(kind)
      expect(error.name).toBe(error.constructor.name)
      expect(error).toBeInstanceOf(Error)
      expect(isAppError(error)).toBe(true)
    }
  })

  it('does not treat other errors as app errors', () => {
    expect(isAppError(new Error('x'))).toBe(false)
    expect(isAppError('x')).toBe(false)
  })
})
