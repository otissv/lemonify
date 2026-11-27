import '@tanstack/react-start/server-only'

import { startChannelServer } from '../channel/channel-server.ts'
import type { ChannelServer } from '../channel/channel-server.ts'
import { AppRole, createApp } from '../composition.ts'
import type { App } from '../composition.ts'
import { channelSocketPath, loadConfig } from '../config/config.ts'
import { readEnvironment } from '../config/environment.ts'
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
  /** Hears the changes made by the other processes, for the open tabs. */
  channel: ChannelServer
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
  const app = await createApp(loadConfig(readEnvironment()), {
    role: AppRole.WebServer,
  })
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
    channel: await startChannelServer({
      socketPath: channelSocketPath(app.config),
      logger: consoleLogger,
      onChange: (userId, event) => app.realtime.publish(userId, event),
      onQueued: (pools) => app.workers?.wake(pools),
    }),
  }
}

/**
 * The one composed app of this web server process. It is kept on
 * `globalThis` so a dev-server reload does not open a second database
 * handle, a second rate limiter or a second worker pool. The pool starts
 * here: the web server runs no Job itself, and its worker processes take the
 * previews, thumbnails, exports and AI steps it queues. However this process
 * ends, its workers see `fork`'s channel close, finish the job they run and
 * exit.
 */
export function getRuntime(): Promise<WebRuntime> {
  const holder = globalThis as Holder
  holder[KEY] ??= build()
  return holder[KEY]
}
