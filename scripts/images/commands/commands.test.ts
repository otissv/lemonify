// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { ImageOptionsError } from '../../../src/lib/images/errors.ts'
import { CliUsageError } from '../cli.ts'
import { infoCommand } from './info.ts'
import { modelsCommand } from './models.ts'
import { sharpCommand } from './sharp.ts'
import { upscaleCommand } from './upscale.ts'

describe('upscale', () => {
  it('maps every flag to options', () => {
    expect(
      upscaleCommand.parse([
        'in',
        'out',
        '--model',
        'realcugan',
        '--scale',
        '2',
        '--noise',
        '0',
        '--iterations',
        '2',
        '--tile-size',
        '256',
        '--max-tile-size',
        '1024',
        '--memory-percent',
        '40',
        '--gpu',
        '0',
        '--threads',
        '2',
        '--tta',
        '--fp32',
        '--ops',
        '[{"op":"webp","quality":80}]',
        '--recursive',
      ]),
    ).toEqual({
      kind: 'run',
      options: {
        source: 'in',
        destination: 'out',
        recursive: true,
        model: 'realcugan',
        scale: 2,
        noise: 0,
        iterations: 2,
        tileSize: 256,
        maxTileSize: 1024,
        memorySafePercentage: 40,
        gpuId: '0',
        threads: 2,
        tta: true,
        fp32: true,
        ops: [{ op: 'webp', quality: 80 }],
      },
    })
  })

  it('builds a custom model from --model-path, --model-name and --model-scale', () => {
    expect(
      upscaleCommand.parse([
        'in',
        'out',
        '--model-path',
        'models',
        '--model-name',
        'mine',
        '--model-scale',
        '2',
      ]),
    ).toMatchObject({
      options: { customModel: { directory: 'models', name: 'mine', scale: 2 } },
    })
  })

  it('needs --model-path for --model-name', () => {
    expect(() =>
      upscaleCommand.parse(['in', 'out', '--model-name', 'mine']),
    ).toThrow(CliUsageError)
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
  it('lists by default and installs named models on request', () => {
    expect(modelsCommand.parse([])).toEqual({
      kind: 'run',
      options: { installAll: false },
    })
    expect(
      modelsCommand.parse([
        '--category',
        'descreen',
        '--install',
        'realcugan',
        '--install',
        'remacri-4x',
      ]),
    ).toMatchObject({
      options: { category: 'descreen', install: ['realcugan', 'remacri-4x'] },
    })
  })

  it('rejects positional arguments, unknown models and conflicting installs', () => {
    expect(() => modelsCommand.parse(['extra'])).toThrow(CliUsageError)
    expect(() => modelsCommand.parse(['--install', 'nope'])).toThrow(
      ImageOptionsError,
    )
    expect(() =>
      modelsCommand.parse(['--install', 'realcugan', '--install-all']),
    ).toThrow(ImageOptionsError)
  })
})

describe.each([sharpCommand, infoCommand, upscaleCommand, modelsCommand])(
  '$name',
  (command) => {
    it.each([['--help'], ['-h']])('returns help for %s', (flag) => {
      expect(command.parse([flag])).toEqual({ kind: 'help' })
    })
  },
)
