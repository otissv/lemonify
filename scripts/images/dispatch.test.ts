// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { CliUsageError } from './cli.ts'
import { COMMANDS } from './commands/index.ts'
import { dispatch, mainUsage } from './dispatch.ts'

function commandNamed(name: string): (typeof COMMANDS)[number] {
  const command = COMMANDS.find((candidate) => candidate.name === name)
  if (!command) throw new Error(`No command named ${name}`)
  return command
}

describe('dispatch', () => {
  it.each([[[]], [['--help']], [['-h']]])(
    'shows the overall help for %j',
    (argv) => {
      expect(dispatch(COMMANDS, argv)).toEqual({
        kind: 'help',
        json: false,
        progress: false,
      })
    },
  )

  it('selects the command and passes the remaining arguments to it', () => {
    expect(
      dispatch(COMMANDS, ['upscale', 'in', 'out', '--scale', '2']),
    ).toEqual({
      kind: 'run',
      command: commandNamed('upscale'),
      argv: ['in', 'out', '--scale', '2'],
      json: false,
      progress: false,
    })
  })

  it('takes --progress from anywhere and removes it', () => {
    expect(
      dispatch(COMMANDS, ['upscale', '--progress', '--job', '{}']),
    ).toMatchObject({
      kind: 'run',
      argv: ['--job', '{}'],
      progress: true,
    })
  })

  it('leaves --help after a command to that command', () => {
    expect(dispatch(COMMANDS, ['sharp', '--help'])).toMatchObject({
      kind: 'run',
      argv: ['--help'],
    })
  })

  it('rejects an unknown command and shows the overall help', () => {
    const run = (): unknown => dispatch(COMMANDS, ['build', 'in', 'out'])

    expect(run).toThrow(CliUsageError)
    expect(run).toThrow('Unknown command "build"')
    try {
      run()
    } catch (error) {
      expect(error).toHaveProperty('usage', mainUsage(COMMANDS))
    }
  })
})

describe('mainUsage', () => {
  it('lists every command with its summary', () => {
    const usage = mainUsage(COMMANDS)
    for (const command of COMMANDS) {
      expect(usage).toContain(command.name)
      expect(usage).toContain(command.summary)
    }
  })
})

describe('COMMANDS', () => {
  it('offers every command', () => {
    const names: string[] = []
    for (const command of COMMANDS) names.push(command.name)
    expect(names).toEqual([
      'sharp',
      'info',
      'upscale',
      'models',
      'formats',
      'schema',
      'user list',
      'source add',
      'source list',
      'source delete',
      'document create',
      'document list',
      'document show',
      'document rename',
      'document move',
      'document delete',
      'document export',
      'document preview',
      'document import',
      'document undo',
      'document redo',
      'document step add',
      'document step remove',
      'document step move',
      'document step set',
      'document step enable',
      'document step disable',
      'document step rename',
      'document step run',
      'export',
      'workflow create',
      'workflow show',
      'workflow list',
      'workflow update',
      'workflow delete',
      'workflow run',
      'workflow results',
      'workflow runs',
      'workflow cancel',
      'workflow run delete',
      'workflow run show',
      'result list',
      'result show',
      'result delete',
      'result save',
      'result clear-unused',
      'job list',
      'job show',
      'job cancel',
      'worker',
    ])
  })

  it.each(COMMANDS.map((command) => [command.name, command] as const))(
    '%s documents itself under pnpm images',
    (name, command) => {
      expect(command.usage).toMatch(new RegExp(`^Usage: pnpm images ${name}`))
    },
  )
})
