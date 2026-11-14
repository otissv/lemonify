import { describe, expect, it } from 'vitest'

import { ImageOptionsError } from '@/lib/images/errors.ts'
import { CliUsageError } from '../../../scripts/images/cli.ts'
import { compressCommand } from '../../../scripts/images/commands/compress.ts'
import { resizeCommand } from '../../../scripts/images/commands/resize.ts'

const parseBuildArgs = resizeCommand.parse
const parseCompressArgs = compressCommand.parse

describe('resize', () => {
  it('maps positionals and flags to build options', () => {
    expect(
      parseBuildArgs([
        './photos',
        './out',
        '--widths',
        '1280,640',
        '--quality',
        '60',
        '--format',
        'avif',
        '--recursive',
        '--manifest',
        'manifest.json',
      ]),
    ).toEqual({
      kind: 'run',
      options: {
        source: './photos',
        destination: './out',
        widths: [640, 1280],
        quality: 60,
        format: 'avif',
        recursive: true,
        manifest: 'manifest.json',
      },
    })
  })

  it('returns help for --help', () => {
    expect(parseBuildArgs(['--help'])).toEqual({ kind: 'help' })
  })

  it('requires a source and a destination', () => {
    expect(() => parseBuildArgs(['./photos'])).toThrow(CliUsageError)
  })

  it('rejects unknown flags with a usage error', () => {
    expect(() => parseBuildArgs(['a', 'b', '--size', '3'])).toThrow(
      CliUsageError,
    )
  })

  it('rejects malformed widths and quality', () => {
    expect(() => parseBuildArgs(['a', 'b', '--widths', '640,abc'])).toThrow(
      ImageOptionsError,
    )
    expect(() => parseBuildArgs(['a', 'b', '--widths', '640,,1280'])).toThrow(
      ImageOptionsError,
    )
    expect(() => parseBuildArgs(['a', 'b', '--quality', 'high'])).toThrow(
      ImageOptionsError,
    )
  })
})

describe('compress', () => {
  it('compresses in place without a destination', () => {
    expect(parseCompressArgs(['./photos'])).toEqual({
      kind: 'run',
      options: {
        source: './photos',
        destination: undefined,
        maxWidth: 1920,
        quality: undefined,
        recursive: false,
      },
    })
  })

  it('accepts a destination, --max-width and --quality', () => {
    expect(
      parseCompressArgs([
        './photos',
        './compressed',
        '--max-width',
        '1280',
        '--quality',
        '70',
      ]),
    ).toEqual({
      kind: 'run',
      options: {
        source: './photos',
        destination: './compressed',
        maxWidth: 1280,
        quality: 70,
        recursive: false,
      },
    })
  })

  it('rejects a missing source or extra positionals', () => {
    expect(() => parseCompressArgs([])).toThrow(CliUsageError)
    expect(() => parseCompressArgs(['a', 'b', 'c'])).toThrow(CliUsageError)
  })
})
