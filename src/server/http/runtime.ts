import '@tanstack/react-start/server-only'

import { createApp } from '../composition.ts'
import type { App } from '../composition.ts'
import { loadConfig } from '../config/config.ts'
import type { HttpRuntime } from './guard.ts'
import { consoleLogger } from './logger.ts'
import { startRealtimeServer } from '../realtime/realtime-server.ts'
import type { RealtimeServer } from '../realtime/realtime-server.ts'
import { FixedWindowRateLimiter } from './rate-limiter.ts'

const KEY = Symbol.for('lemonify.web-runtime')

export type WebRuntime = HttpRuntime & {
  app: App
  /** Tells open tabs about changes. */
  realtime: RealtimeServer
}

type Holder = { [KEY]?: Promise<WebRuntime> }

async function listen(
  app: App,
  rateLimiter: FixedWindowRateLimiter,
): Promise<RealtimeServer> {
  const { host, port } = app.config.realtime
  try {
    return await startRealtimeServer({
      hub: app.realtime,
      auth: app.auth,
      logger: consoleLogger,
      limiter: rateLimiter,
      trustedOrigins: app.config.trustedOrigins,
      host,
      port,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `The realtime server could not listen on ${host}:${port}. Free the port or set LEMONIFY_REALTIME_PORT. ${detail}`,
      { cause: error },
    )
  }
}

async function build(): Promise<WebRuntime> {
  const app = await createApp(loadConfig(process.env))
  await app.startBackground()
  const rateLimiter = new FixedWindowRateLimiter(
    Date.now,
    app.config.rateLimitMultiplier,
  )
  return {
    app,
    auth: app.auth,
    logger: consoleLogger,
    rateLimiter,
    realtime: await listen(app, rateLimiter),
  }
}

/**
 * The one composed app of this web server process. It is kept on
 * `globalThis` so a dev-server reload does not open a second database
 * handle, a second rate limiter or a second scheduler. The scheduler starts
 * here because the web server is what queues most Jobs; without it previews,
 * thumbnails, exports and AI steps would wait for a separate `worker`.
 */
export function getRuntime(): Promise<WebRuntime> {
  const holder = globalThis as Holder
  holder[KEY] ??= build()
  return holder[KEY]
}
