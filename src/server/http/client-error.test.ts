import { describe, expect, it } from 'vitest'

import {
  ConflictError,
  LimitError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../errors'
import { GENERIC_MESSAGE, describeFailure, errorResponse } from './client-error'
import { MemoryLogger } from './logger'

describe('describeFailure', () => {
  it('uses the message and status of a deliberate error', () => {
    const logger = new MemoryLogger()
    const cases: Array<[Error, number]> = [
      [new ValidationError('Enter a name.'), 422],
      [new NotFoundError('That image does not exist.'), 404],
      [new ConflictError('It changed.'), 409],
      [new LimitError('Too many.'), 429],
      [new UnauthorizedError(), 401],
    ]
    for (const [error, status] of cases) {
      expect(describeFailure(error, logger)).toEqual({
        message: error.message,
        status,
      })
    }
  })

  it('hides every other error behind a general message and logs the detail', () => {
    const logger = new MemoryLogger()
    const failure = describeFailure(
      new Error('SQLITE_ERROR: no such table: secrets at /home/x/app.ts'),
      logger,
      { route: '/api/x' },
    )
    expect(failure).toEqual({ message: GENERIC_MESSAGE, status: 500 })
    expect(JSON.stringify(failure)).not.toContain('SQLITE')
    expect(logger.lines[0]?.level).toBe('error')
    expect(logger.lines[0]?.message).toContain('SQLITE_ERROR')
    expect(logger.lines[0]?.fields.route).toBe('/api/x')
  })
})

describe('errorResponse', () => {
  it('sends the project reply shape with the status', async () => {
    const response = errorResponse(
      new NotFoundError('Missing.'),
      new MemoryLogger(),
    )
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ data: [], error: 'Missing.' })
  })
})
