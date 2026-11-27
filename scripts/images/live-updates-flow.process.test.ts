// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { RealtimeEvent } from '../../src/features/realtime/realtime-events.ts'
import { decodeEvent } from '../../src/features/realtime/realtime-events.ts'
import { startChannelServer } from '../../src/server/channel/channel-server.ts'
import type { ChannelServer } from '../../src/server/channel/channel-server.ts'
import { channelSocketPath } from '../../src/server/config/config.ts'
import { MemoryLogger } from '../../src/server/http/logger.ts'
import { RealtimeHub } from '../../src/server/realtime/hub.ts'
import type { RealtimeSocket } from '../../src/server/realtime/hub.ts'
import {
  PROCESS_TIMEOUT,
  cli,
  flow,
  images,
  makeImage,
  setUpFlowFolders,
} from './flow-test-kit.ts'

const CLI_PROCESSES = 3

setUpFlowFolders()

/** A tab the web server has open, as the realtime hub sees it. */
class OpenTab implements RealtimeSocket {
  readonly events: RealtimeEvent[] = []
  readonly bufferedAmount = 0

  send(data: string): void {
    const event = decodeEvent(data)
    if (event !== undefined) this.events.push(event)
  }

  close(): void {}
}

type Doc = { document: { id: string; revision: number } }
type Users = { users: Array<{ id: string }> }

let hub: RealtimeHub
let channel: ChannelServer
let logger: MemoryLogger

beforeEach(async () => {
  logger = new MemoryLogger()
  hub = new RealtimeHub(
    { maxConnectionsPerUser: 10, maxConnections: 10, maxBufferedBytes: 1024 },
    logger,
  )
  channel = await startChannelServer({
    socketPath: channelSocketPath({ dataDir: flow.dataDir }),
    logger,
    onChange: (userId, event) => hub.publish(userId, event),
    onQueued: () => {},
  })
})

afterEach(async () => {
  await channel.close()
})

async function newDocument(name: string): Promise<string> {
  const file = await makeImage(`${name}.png`)
  const { source } = await cli<{ source: { id: string } }>(
    'source',
    'add',
    file,
  )
  const { document } = await cli<Doc>('document', 'create', source.id)
  return document.id
}

/** Opens a tab for the command line's only user, the one every command acts as. */
async function openTab(): Promise<OpenTab> {
  const { users } = await cli<Users>('user', 'list')
  const userId = users[0]?.id
  if (userId === undefined) throw new Error('No user was made.')
  const tab = new OpenTab()
  hub.attach(userId, tab)
  return tab
}

async function eventually(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('changes made with the command line reach the open tabs', () => {
  it('tells the owner’s tabs about an edit made with a command', async () => {
    const documentId = await newDocument('cat')
    const tab = await openTab()

    await cli('document', 'rename', documentId, 'Renamed')

    await eventually(() =>
      tab.events.some(
        (event) =>
          event.type === 'document.updated' && event.documentId === documentId,
      ),
    )
    expect(tab.events).toContainEqual({ type: 'documents.changed' })
  })

  it(
    'hears from several command line processes running at once',
    async () => {
      const ids: string[] = []
      for (let index = 0; index < CLI_PROCESSES; index += 1) {
        ids.push(await newDocument(`picture-${index}`))
      }
      const tab = await openTab()

      await Promise.all(
        ids.map((id, index) =>
          images('document', 'rename', id, `Renamed ${index}`),
        ),
      )

      await eventually(() => {
        const updated = new Set(
          tab.events.flatMap((event) =>
            event.type === 'document.updated' ? [event.documentId] : [],
          ),
        )
        return ids.every((id) => updated.has(id))
      })
      expect(logger.lines.filter((line) => line.level !== 'info')).toEqual([])
    },
    PROCESS_TIMEOUT,
  )

  it('finishes a command as usual when no web server is listening', async () => {
    const documentId = await newDocument('dog')
    await channel.close()

    const renamed = await cli<Doc>('document', 'rename', documentId, 'Alone')

    expect(renamed.document.id).toBe(documentId)
  })
})
