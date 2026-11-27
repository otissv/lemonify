import { describe, expect, it } from 'vitest'

import { readSupervisorMessage, readWorkerMessage } from './worker-messages'

describe('what a worker and its supervisor say to each other', () => {
  it('a worker says when it is ready and when it is stopping', () => {
    expect(readWorkerMessage({ type: 'ready' })).toEqual({ type: 'ready' })
    expect(readWorkerMessage({ type: 'stopping' })).toEqual({
      type: 'stopping',
    })
  })

  it('the supervisor tells a worker to look for a job now', () => {
    expect(readSupervisorMessage({ type: 'wake' })).toEqual({ type: 'wake' })
  })

  it('anything else is not a message either takes', () => {
    for (const value of [
      { type: 'wake', extra: true },
      { type: 'shutdown' },
      'wake',
      null,
      undefined,
    ]) {
      expect(readSupervisorMessage(value)).toBeUndefined()
    }
    expect(readWorkerMessage({ type: 'wake' })).toBeUndefined()
    expect(readWorkerMessage({ type: 'ready', pid: 1 })).toBeUndefined()
  })
})
