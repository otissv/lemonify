import { createServerFn } from '@tanstack/react-start'

import { PUBLIC_CHAIN } from '@/server/http/chains'
import { getRuntime } from '@/server/http/runtime'

export type AuthOptions = {
  /** Whether accounts are confirmed and passwords reset by email. */
  emailEnabled: boolean
}

/** What the sign-in page needs to know about this server before anyone is signed in. */
export const getAuthOptions = createServerFn({ method: 'GET' })
  .middleware(PUBLIC_CHAIN)
  .handler(async (): Promise<AuthOptions> => {
    const runtime = await getRuntime()
    return { emailEnabled: runtime.app.emailEnabled }
  })
