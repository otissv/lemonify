import { createServerFn } from '@tanstack/react-start'

import { PROTECTED_CHAIN } from '@/server/http/chains'
import { appFor } from '@/server/http/server-fn-context'

/** Where this tab opens its live connection. Only a signed-in person is told. */
export const getRealtimeUrl = createServerFn({ method: 'GET' })
  .middleware(PROTECTED_CHAIN)
  .handler(async ({ context }): Promise<string> => {
    const { app } = await appFor(context)
    return app.config.realtime.url
  })
