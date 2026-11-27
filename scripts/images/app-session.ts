import { createApp } from '../../src/server/composition.ts'
import type { App } from '../../src/server/composition.ts'
import { loadConfig } from '../../src/server/config/config.ts'
import { readEnvironment } from '../../src/server/config/environment.ts'
import type { Actor } from '../../src/server/domain/actor.ts'

export const USER_FLAG = '--user'
export const USER_ENVIRONMENT_VARIABLE = 'LEMONIFY_USER'

/**
 * Builds the same services the web server uses, runs one command with them,
 * and closes them. The CLI needs no running server: it works on the machine
 * that holds the data.
 */
export async function withApp<T>(run: (app: App) => Promise<T>): Promise<T> {
  const app = await createApp(loadConfig(readEnvironment()))
  try {
    return await run(app)
  } finally {
    await app.close()
  }
}

/** The User named by `--user`, or by the environment, or the only User. */
export function requestedUser(flag: string | undefined): string | undefined {
  return flag ?? process.env[USER_ENVIRONMENT_VARIABLE]
}

export async function withActor<T>(
  user: string | undefined,
  run: (app: App, actor: Actor) => Promise<T>,
): Promise<T> {
  return withApp(async (app) => {
    const actor = await app.users.resolveActor(requestedUser(user))
    return run(app, actor)
  })
}
