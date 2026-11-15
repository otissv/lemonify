import '@tanstack/react-start/server-only'

import { createApp } from '../composition.ts'
import type { App } from '../composition.ts'
import { loadConfig } from '../config/config.ts'
import type { HttpRuntime } from './guard.ts'
import { consoleLogger } from './logger.ts'
import { FixedWindowRateLimiter } from './rate-limiter.ts'

const KEY = Symbol.for('lemonify.web-runtime')

export type WebRuntime = HttpRuntime & { app: App }

type Holder = { [KEY]?: Promise<WebRuntime> }

async function build(): Promise<WebRuntime> {
  const app = await createApp(loadConfig(process.env))
  await app.startBackground()
  return {
    app,
    auth: app.auth,
    logger: consoleLogger,
    rateLimiter: new FixedWindowRateLimiter(),
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
