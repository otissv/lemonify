import { describe, expect, it } from 'vitest'

import { readErrorMessage } from './read-error-message'

describe('readErrorMessage', () => {
  it('takes the reason from the answer', async () => {
    const response = new Response(JSON.stringify({ data: [], error: 'Nope.' }))
    expect(await readErrorMessage(response, 'Fallback.')).toBe('Nope.')
  })

  it('uses the fallback for an empty reason, another shape or no JSON', async () => {
    for (const body of ['{"error":""}', '{"x":1}', '[]', 'null', '<html>']) {
      expect(await readErrorMessage(new Response(body), 'Fallback.')).toBe(
        'Fallback.',
      )
    }
  })
})
