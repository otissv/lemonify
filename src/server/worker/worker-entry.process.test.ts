// @vitest-environment node
import { fork } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { WorkerPool } from '@/features/ai/ai-tools'

import { JobState } from '../jobs/job-types'
import { createTestApp } from '../testing/test-app'
import type { TestApp } from '../testing/test-app'
import { WORKER_ENTRY, WORKER_EXEC_ARGV } from './fork-worker'
import { workerEnvironment, workerPriority } from './worker-environment'

const ROOT = path.resolve(import.meta.dirname, '../../..')
const PROCESS_TIMEOUT = 60_000

let t: TestApp
const children: ChildProcess[] = []

beforeEach(async () => {
  t = await createTestApp()
})

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGKILL')
  }
  await t.close()
})

/** Starts `main.ts` the way the pool does, but with the test watching its output and messages. */
function startWorker(pool: string): {
  child: ChildProcess
  output: () => string
} {
  const env = workerEnvironment(WorkerPool.Cpu, t.app.config, process.env)
  const child = fork(WORKER_ENTRY, [pool], {
    cwd: ROOT,
    env,
    execArgv: [...WORKER_EXEC_ARGV],
    silent: true,
  })
  children.push(child)
  let output = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })
  return { child, output: () => output }
}

/** Its exit code once it has exited; fails with what it printed if it has not exited in time. */
function exited(
  child: ChildProcess,
  output: () => string,
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(child.exitCode)
      return
    }
    const timer = setTimeout(() => {
      reject(new Error(`The worker did not exit. It printed:\n${output()}`))
    }, PROCESS_TIMEOUT / 2)
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
}

async function eventually(
  check: () => Promise<boolean> | boolean,
): Promise<void> {
  const deadline = Date.now() + PROCESS_TIMEOUT / 2
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

async function queuedPreview(): Promise<string> {
  const source = await t.uploadImage(t.ann)
  const document = await t.app.documents.create(t.ann, source.id)
  return (await t.app.renders.requestPreview(t.ann, document.id)).id
}

describe('the worker process', () => {
  it(
    'runs the jobs of its pool, and stops cleanly when it is told to',
    async () => {
      const id = await queuedPreview()
      const { child, output } = startWorker('cpu')

      await eventually(
        async () => (await t.app.jobs.get(t.ann, id)).state === JobState.Done,
      )
      child.kill('SIGTERM')

      expect(await exited(child, output)).toBe(0)
      expect(output()).toContain('"message":"Worker started"')
    },
    PROCESS_TIMEOUT,
  )

  it(
    'tells the process that started it when it is ready, and when it is stopping',
    async () => {
      const { child, output } = startWorker('cpu')
      const messages: unknown[] = []
      child.on('message', (message) => messages.push(message))
      await eventually(() => messages.length === 1)
      expect(messages).toEqual([{ type: 'ready' }])

      child.kill('SIGTERM')

      expect(await exited(child, output)).toBe(0)
      expect(messages).toEqual([{ type: 'ready' }, { type: 'stopping' }])
    },
    PROCESS_TIMEOUT,
  )

  it(
    'runs at a lower priority than the web server, so the server answers first while images are processed',
    async () => {
      const { child, output } = startWorker('cpu')
      await eventually(() => output().includes('Worker started'))

      // It starts at this process's priority, as the web server's workers start at the server's.
      expect(os.getPriority(child.pid)).toBe(workerPriority(os.getPriority()))

      child.kill('SIGTERM')
      expect(await exited(child, output)).toBe(0)
    },
    PROCESS_TIMEOUT,
  )

  it(
    'stops when the process that started it goes away',
    async () => {
      const { child, output } = startWorker('cpu')
      await eventually(() => output().includes('Worker started'))

      child.disconnect()

      expect(await exited(child, output)).toBe(0)
    },
    PROCESS_TIMEOUT,
  )

  it(
    'refuses to start without a pool it knows, saying which it takes',
    async () => {
      const { child, output } = startWorker('quantum')

      expect(await exited(child, output)).not.toBe(0)
      expect(output()).toMatch(/cpu.*gpu/)
    },
    PROCESS_TIMEOUT,
  )
})
