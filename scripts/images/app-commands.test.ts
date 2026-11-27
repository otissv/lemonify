// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ImageOptionsError } from '../../src/lib/images/errors.ts'
import { ConflictError, NotFoundError } from '../../src/server/errors.ts'
import { CliUsageError, runCli } from './cli.ts'
import { COMMANDS } from './commands/index.ts'
import { dispatch } from './dispatch.ts'
import { stubTestDatabase } from './flow-test-kit.ts'
import type { TestDatabase } from '../../src/server/testing/test-database.ts'

let dataDir = ''
let database: TestDatabase | undefined
beforeEach(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'lemonify-cli-'))
  vi.stubEnv('LEMONIFY_DATA_DIR', dataDir)
  database = await stubTestDatabase()
})
afterEach(async () => {
  await database?.close()
  database = undefined
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  process.exitCode = undefined
  rmSync(dataDir, { recursive: true, force: true })
})

describe('dispatch with two-word commands', () => {
  it('selects `user list` and passes the rest to it', () => {
    const selected = dispatch(COMMANDS, ['user', 'list', '--json'])
    expect(selected).toMatchObject({
      kind: 'run',
      argv: [],
      json: true,
    })
    if (selected.kind === 'run') {
      expect(selected.command.name).toBe('user list')
    }
  })

  it('asks for a subcommand when only the group is given', () => {
    expect(() => dispatch(COMMANDS, ['user'])).toThrow(CliUsageError)
    expect(() => dispatch(COMMANDS, ['user'])).toThrow(/user list/)
  })

  it('still rejects an unknown command', () => {
    expect(() => dispatch(COMMANDS, ['nonsense'])).toThrow(/Unknown command/)
  })
})

describe('user list', () => {
  it('lists no users on a fresh machine', async () => {
    const lines: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      lines.push(line)
    })
    const selected = dispatch(COMMANDS, ['user', 'list', '--json'])
    if (selected.kind !== 'run') throw new Error('expected a command')
    await selected.command.execute(selected.argv, {
      json: true,
      progress: false,
    })
    expect(JSON.parse(lines.join('\n'))).toEqual({
      command: 'user list',
      result: { users: [] },
    })
  })
})

describe('runCli exit codes', () => {
  it.each([
    [new NotFoundError('There is no user "x".'), 3, 'not-found'],
    [new ConflictError('It changed.'), 4, 'conflict'],
  ])('reports %s with its own exit code', async (error, code, type) => {
    const errors: string[] = []
    vi.spyOn(console, 'error').mockImplementation((line: string) => {
      errors.push(line)
    })
    await runCli(() => Promise.reject(error), { json: true })
    expect(process.exitCode).toBe(code)
    expect(JSON.parse(errors[0] ?? '{}')).toEqual({
      error: { type, message: error.message },
    })
  })

  it('keeps exit code 1 for any other failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await runCli(() => Promise.reject(new Error('boom')), { json: false })
    expect(process.exitCode).toBe(1)
  })
})

async function runJson(argv: string[]): Promise<unknown> {
  const lines: string[] = []
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    lines.push(line)
  })
  const selected = dispatch(COMMANDS, [...argv, '--json'])
  if (selected.kind !== 'run') throw new Error('expected a command')
  await selected.command.execute(selected.argv, { json: true, progress: false })
  return JSON.parse(lines.join('\n'))
}

describe('ai tools', () => {
  it('lists the AI tools the Tools panel offers', async () => {
    expect(await runJson(['ai', 'tools'])).toEqual({
      command: 'ai tools',
      result: {
        tools: [
          { id: 'upscale', label: 'Upscale', pool: 'gpu', output: 'image' },
        ],
      },
    })
  })
})

describe('ai catalogue', () => {
  it("prints a tool's models and the one a new step starts with", async () => {
    const output = await runJson(['ai', 'catalogue', 'upscale'])
    expect(output).toMatchObject({
      command: 'ai catalogue',
      result: {
        tool: 'upscale',
        catalogue: { defaultModel: expect.any(String) },
      },
    })
    const { catalogue } = (
      output as {
        result: {
          catalogue: { defaultModel: string; models: Array<{ name: string }> }
        }
      }
    ).result
    expect(catalogue.models.map(({ name }) => name)).toContain(
      catalogue.defaultModel,
    )
  })

  it('refuses a tool that does not exist', async () => {
    const selected = dispatch(COMMANDS, ['ai', 'catalogue', 'nonsense'])
    if (selected.kind !== 'run') throw new Error('expected a command')
    await expect(
      selected.command.execute(selected.argv, { json: true, progress: false }),
    ).rejects.toThrow(ImageOptionsError)
  })
})

describe('export formats', () => {
  it('lists the formats the export picker offers, starting with the original', async () => {
    const output = (await runJson(['export', 'formats'])) as {
      command: string
      result: { formats: string[] }
    }
    expect(output.command).toBe('export formats')
    expect(output.result.formats[0]).toBe('original')
    expect(output.result.formats).toContain('png')
  })

  it('still exports a document whose id is given', () => {
    const selected = dispatch(COMMANDS, ['export', 'doc-1', '--out', 'x.png'])
    if (selected.kind !== 'run') throw new Error('expected a command')
    expect(selected.command.name).toBe('export')
  })
})
