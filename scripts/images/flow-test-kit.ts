import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import sharp from 'sharp'
import { afterEach, beforeEach, vi } from 'vitest'

import {
  createTestDatabase,
  databaseEnvironment,
} from '../../src/server/testing/test-database.ts'
import type { TestDatabase } from '../../src/server/testing/test-database.ts'
import { COMMANDS } from './commands/index.ts'
import { dispatch } from './dispatch.ts'

/** The folders a command-line flow test works in: a data folder of its own, and one for the files it writes. */
export const flow = { dataDir: '', workDir: '' }

/** Points the command line at a database of the test's own. */
export async function stubTestDatabase(): Promise<TestDatabase> {
  const test = await createTestDatabase()
  await test.database.destroy()
  for (const [name, value] of Object.entries(databaseEnvironment(test.config)))
    vi.stubEnv(name, value)
  return test
}

/** Gives each test of the file empty folders and an empty database, and points the command line at them. */
export function setUpFlowFolders(): void {
  let database: TestDatabase | undefined
  beforeEach(async () => {
    flow.dataDir = mkdtempSync(path.join(os.tmpdir(), 'lemonify-flow-data-'))
    flow.workDir = mkdtempSync(path.join(os.tmpdir(), 'lemonify-flow-work-'))
    vi.stubEnv('LEMONIFY_DATA_DIR', flow.dataDir)
    database = await stubTestDatabase()
  })
  afterEach(async () => {
    await database?.close()
    database = undefined
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    rmSync(flow.dataDir, { recursive: true, force: true })
    rmSync(flow.workDir, { recursive: true, force: true })
  })
}

/** Runs one command as a person would, with --json, and gives back its result. */
export async function cli<T = Record<string, unknown>>(
  ...argv: string[]
): Promise<T> {
  const lines: string[] = []
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    lines.push(line)
  })
  const selected = dispatch(COMMANDS, [...argv, '--json'])
  if (selected.kind !== 'run') throw new Error('expected a command')
  await selected.command.execute(selected.argv, { json: true, progress: false })
  vi.restoreAllMocks()
  const parsed: { result: T } = JSON.parse(lines.join('\n'))
  return parsed.result
}

/** Writes a small PNG of one colour in the work folder and returns its path. */
export async function makeImage(
  name: string,
  size: { width: number; height: number } = { width: 64, height: 48 },
  colour = '#d33',
): Promise<string> {
  const file = path.join(flow.workDir, name)
  await sharp({ create: { ...size, channels: 3, background: colour } })
    .png()
    .toFile(file)
  return file
}
