// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { CliUsageError } from '../cli.ts'
import { compressCommand } from './compress.ts'
import { modelsCommand } from './models.ts'
import { resizeCommand } from './resize.ts'
import { upscaleCommand } from './upscale.ts'

describe('upscale', () => {
  it('parses model and scale', () => {
    expect(
      upscaleCommand.parse([
        'in',
        'out',
        '--model',
        'animevideov3',
        '--scale',
        '2',
      ]),
    ).toMatchObject({
      kind: 'run',
      options: { model: 'animevideov3', scale: 2 },
    })
  })

  it('rejects unknown options with its own usage', () => {
    try {
      upscaleCommand.parse(['in', 'out', '--width', '2'])
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(CliUsageError)
      expect(error).toHaveProperty('usage', upscaleCommand.usage)
    }
  })
})

describe('models', () => {
  it('takes no arguments', () => {
    expect(modelsCommand.parse([])).toEqual({ kind: 'run', options: {} })
    expect(() => modelsCommand.parse(['extra'])).toThrow(CliUsageError)
  })
})

describe.each([resizeCommand, compressCommand, upscaleCommand, modelsCommand])(
  '$name',
  (command) => {
    it.each([['--help'], ['-h']])('returns help for %s', (flag) => {
      expect(command.parse([flag])).toEqual({ kind: 'help' })
    })
  },
)
