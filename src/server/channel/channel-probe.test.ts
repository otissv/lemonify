// @vitest-environment node
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MemoryLogger } from '../http/logger'
import { webServerAnswers } from './channel-probe'
import { startChannelServer } from './channel-server'

let dir = ''
let socketPath = ''

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'lemonify-probe-'))
  socketPath = path.join(dir, 'run', 'lemonify.sock')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('whether a web server is running on a data folder', () => {
  it('is so when its socket answers', async () => {
    const server = await startChannelServer({
      socketPath,
      logger: new MemoryLogger(),
      onChange: () => {},
      onQueued: () => {},
    })
    try {
      expect(await webServerAnswers(socketPath)).toBe(true)
    } finally {
      await server.close()
    }
    expect(await webServerAnswers(socketPath)).toBe(false)
  })

  it('is not when there is no socket', async () => {
    expect(await webServerAnswers(socketPath)).toBe(false)
  })

  it('is not when the socket was left by a web server that was killed', async () => {
    mkdirSync(path.dirname(socketPath), { recursive: true, mode: 0o700 })
    const child = spawn(process.execPath, [
      '-e',
      `require('node:net').createServer().listen(${JSON.stringify(socketPath)}, () => console.log('up'))`,
    ])
    await new Promise<void>((resolve) =>
      child.stdout.once('data', () => resolve()),
    )
    const exited = new Promise<void>((resolve) =>
      child.once('exit', () => resolve()),
    )
    child.kill('SIGKILL')
    await exited

    expect(await webServerAnswers(socketPath)).toBe(false)
  })
})
