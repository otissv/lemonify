import { describe, expect, it } from 'vitest'

import { ROUTE_METHODS, notFoundRoute, onlyMethods } from './api-methods.ts'

const context = { request: new Request('http://localhost/api/x'), params: {} }

async function answerOk(): Promise<Response> {
  return new Response('ok')
}

describe('onlyMethods', () => {
  it('runs the handler of a method the route has', async () => {
    const handlers = onlyMethods({ GET: answerOk })

    expect(await (await handlers.GET(context)).text()).toBe('ok')
  })

  it('answers every other method 405, with the methods it takes and the project’s error shape', async () => {
    const handlers = onlyMethods({ GET: answerOk, POST: answerOk })

    for (const method of ROUTE_METHODS.filter(
      (name) => name !== 'GET' && name !== 'POST',
    )) {
      const response = await handlers[method](context)
      expect(response.status).toBe(405)
      expect(response.headers.get('Allow')).toBe('GET, POST')
      expect(await response.json()).toEqual({
        data: [],
        error: 'Use GET or POST here.',
      })
    }
  })
})

describe('notFoundRoute', () => {
  it('answers every method 404 in the project’s error shape', async () => {
    const handlers = notFoundRoute()

    for (const method of ROUTE_METHODS) {
      const response = await handlers[method](context)
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({
        data: [],
        error: 'There is nothing at this address.',
      })
    }
  })
})
