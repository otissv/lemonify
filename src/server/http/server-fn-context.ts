import '@tanstack/react-start/server-only'

import type { App } from '../composition.ts'
import type { Actor } from '../domain/actor.ts'
import { UnauthorizedError } from '../errors.ts'
import { getRuntime } from './runtime.ts'

/**
 * The composed app and the signed-in User for a server function. Its chain
 * has already required a User; this narrows the type and fails closed if one
 * is somehow missing.
 */
export async function appFor(context: {
  actor: Actor | null
}): Promise<{ app: App; actor: Actor }> {
  if (context.actor === null) throw new UnauthorizedError()
  const runtime = await getRuntime()
  return { app: runtime.app, actor: context.actor }
}
