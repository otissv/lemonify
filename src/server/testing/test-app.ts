import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import sharp from 'sharp'

import type { App } from '../composition.ts'
import { createApp } from '../composition.ts'
import { databaseEnvironment, loadConfig } from '../config/config.ts'
import type { Config } from '../config/config.ts'
import type { SourceRecord } from '../dao/source-dao.ts'
import type { Actor } from '../domain/actor.ts'
import type { AuthGateway } from '../auth/auth-gateway.ts'
import { MemoryLogger } from '../http/logger.ts'
import { createTestDatabase, insertTestUser } from './test-database.ts'
import { FakeAiEngine, FakeImageEngine, RecordingPublisher } from './fakes.ts'

/** An auth system that is never asked anything; tests act as an Actor directly. */
const NO_AUTH: AuthGateway = {
  getActor: async () => null,
  signUp: async () => {
    throw new Error('Sign-up is not available in this test.')
  },
  handle: async () => new Response(null, { status: 404 }),
  close: async () => {},
}

export type TestApp = {
  app: App
  directory: string
  imageEngine: FakeImageEngine
  aiEngine: FakeAiEngine
  logger: MemoryLogger
  /** What the services told people's tabs. */
  changes: RecordingPublisher
  ann: Actor
  bob: Actor
  /** Uploads a small real PNG for the actor; the colour makes the bytes (and so the Source) differ. */
  uploadImage(
    actor: Actor,
    colour?: string,
    name?: string,
  ): Promise<SourceRecord>
  close(): Promise<void>
}

async function png(colour: string): Promise<Buffer> {
  return sharp({
    create: { width: 8, height: 6, channels: 3, background: colour },
  })
    .png()
    .toBuffer()
}

/**
 * The real composition on a database and data folder of its own, with the two
 * engines replaced by fakes, so the services, DAOs, stores and scheduler all
 * run for real and only the slow image work is stood in for.
 */
export async function createTestApp(
  settings: Record<string, string> = {},
): Promise<TestApp> {
  const directory = await mkdtemp(path.join(tmpdir(), 'lemonify-test-app-'))
  const test = await createTestDatabase()
  await test.database.destroy()
  const config: Config = loadConfig(
    {
      ...databaseEnvironment(test.config),
      LEMONIFY_DATA_DIR: directory,
      ...settings,
    },
    2,
    directory,
  )
  const imageEngine = new FakeImageEngine()
  const aiEngine = new FakeAiEngine()
  const logger = new MemoryLogger()
  const changes = new RecordingPublisher()
  const app = await createApp(config, {
    auth: NO_AUTH,
    imageEngine,
    aiEngine,
    logger,
    changes,
  })
  await insertTestUser(app.database, 'ann', 'Ann')
  await insertTestUser(app.database, 'bob', 'Bob')
  const ann = { userId: 'ann', name: 'Ann' }
  const bob = { userId: 'bob', name: 'Bob' }
  return {
    app,
    directory,
    imageEngine,
    aiEngine,
    logger,
    changes,
    ann,
    bob,
    async uploadImage(actor, colour = '#336699', name = 'cat.png') {
      const bytes = await png(colour)
      return app.sources.upload(
        actor,
        (async function* () {
          yield bytes
        })(),
        name,
      )
    },
    async close() {
      await app.close()
      await test.close()
      await rm(directory, { recursive: true, force: true })
    },
  }
}
