// @vitest-environment node
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ImageOptionsError } from '../../src/lib/images/errors.ts'
import { CliUsageError, runCli } from './cli.ts'
import { COMMANDS } from './commands/index.ts'
import { formatsCommand } from './commands/formats.ts'
import { infoCommand } from './commands/info.ts'
import { schemaCommand } from './commands/schema.ts'
import { sharpCommand } from './commands/sharp.ts'
import { dispatch } from './dispatch.ts'

function captureStdout(): { output: () => string } {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  return {
    output: () => {
      const lines: string[] = []
      for (const call of spy.mock.calls) lines.push(String(call[0]))
      return lines.join('\n')
    },
  }
}

describe('--json', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is recognised anywhere and removed before the command parses', () => {
    expect(dispatch(COMMANDS, ['--json', 'info', 'a.png'])).toMatchObject({
      kind: 'run',
      argv: ['a.png'],
      json: true,
    })
    expect(dispatch(COMMANDS, ['info', 'a.png', '--json'])).toMatchObject({
      argv: ['a.png'],
      json: true,
    })
  })

  it('prints the command result as one JSON document', async () => {
    const stdout = captureStdout()

    await formatsCommand.execute([], { json: true, progress: false })

    const document: unknown = JSON.parse(stdout.output())
    expect(document).toMatchObject({
      command: 'formats',
      result: { versions: expect.any(Object), formats: expect.any(Array) },
    })
  })

  it('reports errors as JSON on stderr and sets the exit code', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await runCli(
      async () => {
        throw new ImageOptionsError(['quality: too high'])
      },
      { json: true },
    )

    expect(JSON.parse(String(spy.mock.calls[0]?.[0]))).toEqual({
      error: {
        type: 'ImageOptionsError',
        message: expect.stringContaining('quality: too high'),
        issues: ['quality: too high'],
      },
    })
    expect(process.exitCode).toBe(1)
    process.exitCode = 0
  })
})

describe('--job', () => {
  let directory = ''

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'lemonify-job-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('reads the options object inline and fills in defaults', () => {
    expect(infoCommand.resolve(['--job', '{"source":"in"}'])).toEqual({
      kind: 'run',
      options: { source: 'in', stats: false, recursive: false },
    })
  })

  it('reads the options object from a file with @', async () => {
    const file = path.join(directory, 'job.json')
    await writeFile(
      file,
      JSON.stringify({
        output: 'out.png',
        options: {
          create: { width: 2, height: 2, channels: 3, background: '#000' },
        },
        ops: [{ op: 'negate' }],
      }),
    )

    expect(sharpCommand.resolve(['--job', `@${file}`])).toMatchObject({
      kind: 'run',
      options: { output: 'out.png', ops: [{ op: 'negate' }] },
    })
  })

  it('rejects malformed JSON as a usage error', () => {
    expect(() => infoCommand.resolve(['--job', '{nope'])).toThrow(CliUsageError)
  })

  it('rejects mixing --job with other arguments', () => {
    expect(() =>
      infoCommand.resolve(['in', '--job', '{"source":"in"}']),
    ).toThrow(CliUsageError)
  })

  it('validates the object against the command schema', () => {
    expect(() =>
      infoCommand.resolve(['--job', '{"source":"in","stats":"yes"}']),
    ).toThrow(ImageOptionsError)
  })
})

describe('sharp command flags', () => {
  it('maps flags and JSON values to a job', () => {
    expect(
      sharpCommand.parse([
        '--input',
        'a.png',
        '--input',
        'b.png',
        '--output',
        'out.png',
        '--options',
        '{"join":{"across":2}}',
        '--ops',
        '[{"op":"flip"}]',
        '--settings',
        '{"concurrency":1}',
      ]),
    ).toMatchObject({
      kind: 'run',
      options: {
        input: ['a.png', 'b.png'],
        output: 'out.png',
        options: { join: { across: 2 } },
        ops: [{ op: 'flip' }],
        settings: { concurrency: 1 },
        recursive: false,
      },
    })
  })

  it('maps --widths and --manifest to variants', () => {
    expect(
      sharpCommand.parse([
        '--input',
        'photos',
        '--output',
        'out',
        '--widths',
        '320,640',
        '--manifest',
        'out/manifest.json',
        '--format-options',
        '{"webp":{"quality":78}}',
      ]),
    ).toMatchObject({
      options: {
        variants: { widths: [320, 640], manifest: 'out/manifest.json' },
        formatOptions: { webp: { quality: 78 } },
      },
    })
  })

  it('maps --dry-run', () => {
    expect(
      sharpCommand.parse([
        '--input',
        'a.png',
        '--output',
        'b.png',
        '--dry-run',
      ]),
    ).toMatchObject({ options: { dryRun: true } })
  })

  it('maps --in-place without an output', () => {
    expect(
      sharpCommand.parse(['--input', 'photos', '--in-place', 'ifSmaller']),
    ).toMatchObject({ options: { input: 'photos', inPlace: 'ifSmaller' } })
  })

  it('needs --widths for --manifest', () => {
    expect(() =>
      sharpCommand.parse([
        '--input',
        'a.png',
        '--output',
        'out',
        '--manifest',
        'm.json',
      ]),
    ).toThrow(CliUsageError)
  })

  it.each([
    [['--input', 'a.png', '--output', 'out', '--widths', '10,x']],
    [['--input', 'a.png', '--in-place', 'never']],
  ])('rejects invalid values in %j', (argv) => {
    expect(() => sharpCommand.parse(argv)).toThrow(ImageOptionsError)
  })

  it('keeps a single --input as a path', () => {
    expect(
      sharpCommand.parse(['--input', 'a.png', '--output', 'b.png']),
    ).toMatchObject({ options: { input: 'a.png' } })
  })
})

describe('schema command', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prints the JSON Schema of every command keyed by name', async () => {
    const stdout = captureStdout()

    await schemaCommand.execute([], { json: false, progress: false })

    const schemas = JSON.parse(stdout.output()) as Record<string, unknown>
    for (const command of COMMANDS) expect(schemas).toHaveProperty(command.name)
  })

  it('prints one command when named', async () => {
    const stdout = captureStdout()

    await schemaCommand.execute(['sharp'], { json: false, progress: false })

    expect(stdout.output()).toContain('"pipelineColourspace"')
  })

  it('rejects an unknown command name', () => {
    expect(() => schemaCommand.resolve(['nope'])).toThrow(ImageOptionsError)
  })
})

describe('--dry-run output', () => {
  let directory = ''

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'lemonify-dry-run-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(directory, { recursive: true, force: true })
  })

  it('prints the plan for sharp and writes nothing', async () => {
    const output = path.join(directory, 'blank.png')
    const stdout = captureStdout()

    await sharpCommand.execute(
      [
        '--output',
        output,
        '--options',
        '{"create":{"width":2,"height":2,"channels":3,"background":"#000"}}',
        '--dry-run',
      ],
      { json: false, progress: false },
    )

    expect(stdout.output()).toContain('Would write 1 file, read 0')
    await expect(access(output)).rejects.toThrow()
  })

  it('prints the plan as JSON', async () => {
    const output = path.join(directory, 'blank.png')
    const stdout = captureStdout()

    await sharpCommand.execute(
      [
        '--output',
        output,
        '--options',
        '{"create":{"width":2,"height":2,"channels":3,"background":"#000"}}',
        '--dry-run',
      ],
      { json: true, progress: false },
    )

    expect(JSON.parse(stdout.output())).toEqual({
      command: 'sharp',
      result: {
        dryRun: true,
        reads: [],
        writes: [{ file: output, source: null, kind: 'file', exists: false }],
      },
    })
  })
})
