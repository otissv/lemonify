import { describe, expect, it } from 'vitest'

import { ImageOptionsError } from './errors.ts'
import {
  DEFAULT_FORMAT,
  DEFAULT_MAX_WIDTH,
  DEFAULT_QUALITY,
  DEFAULT_WIDTHS,
  parseBuildOptions,
  parseCompressOptions,
} from './options.ts'

describe('parseBuildOptions', () => {
  it('fills in the defaults', () => {
    expect(parseBuildOptions({ source: 'in', destination: 'out' })).toEqual({
      source: 'in',
      destination: 'out',
      widths: [...DEFAULT_WIDTHS],
      format: DEFAULT_FORMAT,
      quality: DEFAULT_QUALITY,
      recursive: false,
      manifest: undefined,
    })
  })

  it('sorts and de-duplicates widths', () => {
    const options = parseBuildOptions({
      source: 'in',
      destination: 'out',
      widths: [1280, 640, 1280],
    })
    expect(options.widths).toEqual([640, 1280])
  })

  it.each([[[0]], [[-480]], [[480.5]], [[Number.NaN]], [[]]])(
    'rejects widths %j',
    (widths) => {
      expect(() =>
        parseBuildOptions({ source: 'in', destination: 'out', widths }),
      ).toThrow(ImageOptionsError)
    },
  )

  it.each([0, 101, 50.5, Number.NaN])('rejects quality %d', (quality) => {
    expect(() =>
      parseBuildOptions({ source: 'in', destination: 'out', quality }),
    ).toThrow(/Quality must be an integer from 1 to 100/)
  })

  it('rejects an unknown format and names the allowed ones', () => {
    expect(() =>
      parseBuildOptions({ source: 'in', destination: 'out', format: 'gif' }),
    ).toThrow(/webp, avif, jpeg, png/)
  })

  it('requires a source and a destination', () => {
    expect(() => parseBuildOptions({ source: '', destination: 'out' })).toThrow(
      ImageOptionsError,
    )
    expect(() => parseBuildOptions({ source: 'in' })).toThrow(ImageOptionsError)
  })
})

describe('parseCompressOptions', () => {
  it('defaults to in place with the default max width', () => {
    expect(parseCompressOptions({ source: 'in' })).toEqual({
      source: 'in',
      destination: undefined,
      maxWidth: DEFAULT_MAX_WIDTH,
      quality: undefined,
      recursive: false,
    })
  })

  it('rejects a non-positive max width', () => {
    expect(() => parseCompressOptions({ source: 'in', maxWidth: 0 })).toThrow(
      /Max width must be a positive integer/,
    )
  })

  it('rejects an out-of-range quality', () => {
    expect(() => parseCompressOptions({ source: 'in', quality: 200 })).toThrow(
      ImageOptionsError,
    )
  })
})
