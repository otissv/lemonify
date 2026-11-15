import { getRequestHeaders } from '@tanstack/react-start/server'

import type { Actor } from '@/server/domain/actor'
import { createServerFn } from '@tanstack/react-start'

import { PUBLIC_CHAIN } from '@/server/http/chains'
import { getRuntime } from '@/server/http/runtime'

/** The signed-in User for this request, or null; never an error, so pages can redirect. */
export const getSessionFn = createServerFn({ method: 'GET' })
  .middleware(PUBLIC_CHAIN)
  .handler(async (): Promise<Actor | null> => {
    const runtime = await getRuntime()
    return runtime.auth.getActor(getRequestHeaders())
  })
