// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { ImageOptionsError } from './errors.ts'
import { parseUpscaleOptions, resolveModel } from './upscale-options.ts'
import {
  DEFAULT_UPSCALE_MODEL,
  MODEL_CATEGORIES,
  modelManifest,
} from './upscale-models.ts'

const PATHS = { source: 'in', destination: 'out' }

describe('parseUpscaleOptions', () => {
  it('fills in the defaults', () => {
    expect(parseUpscaleOptions(PATHS)).toEqual({
      ...PATHS,
      recursive: false,
      iterations: 1,
      tta: false,
      fp32: false,
      ops: [],
    })
  })

  it('accepts every Upscayl setting and a Sharp post-pipeline', () => {
    const options = parseUpscaleOptions({
      ...PATHS,
      model: 'realcugan',
      scale: 3,
      noise: 0,
      iterations: 2,
      tileSize: 256,
      maxTileSize: 1024,
      memorySafePercentage: 40,
      gpuId: '0,1',
      threads: 4,
      tta: true,
      fp32: true,
      ops: [
        { op: 'resize', width: 2000 },
        { op: 'avif', quality: 60 },
      ],
    })
    expect(options).toMatchObject({ model: 'realcugan', scale: 3, noise: 0 })
  })

  it.each([
    [{ model: 'nope' }, /model/],
    [{ scale: 8 }, /4x_NMKD-Siax_200k offers scale 2, 3, 4/],
    [{ noise: 1 }, /4x_NMKD-Siax_200k has no noise levels/],
    [{ model: 'realcugan', noise: 2 }, /realcugan offers noise -1, 0, 3/],
    [{ iterations: 4 }, /iterations/],
    [{ tileSize: 16 }, /tileSize/],
    [{ gpuId: 'first' }, /gpuId/],
    [{ ops: [{ op: 'explode' }] }, /ops/],
    [
      {
        model: 'realcugan',
        customModel: { directory: 'm', name: 'x', scale: 4 },
      },
      /either model or customModel/,
    ],
  ])('rejects %j', (overrides, message) => {
    expect(() => parseUpscaleOptions({ ...PATHS, ...overrides })).toThrow(
      message,
    )
  })

  it('requires a destination', () => {
    expect(() => parseUpscaleOptions({ source: 'in' })).toThrow(
      ImageOptionsError,
    )
  })

  it('accepts a custom model folder', () => {
    const options = parseUpscaleOptions({
      ...PATHS,
      customModel: { directory: 'models', name: 'my-model-4x', scale: 4 },
    })
    expect(options.customModel).toEqual({
      directory: 'models',
      name: 'my-model-4x',
      scale: 4,
    })
    expect(options.model).toBeUndefined()
  })

  it('rejects a custom model named like a catalogue model', () => {
    expect(() =>
      parseUpscaleOptions({
        ...PATHS,
        customModel: { directory: 'm', name: 'realcugan', scale: 4 },
      }),
    ).toThrow(/clashes with a catalogue model/)
  })
})

describe('resolveModel', () => {
  it('defaults the scale to the largest the model offers', () => {
    expect(resolveModel(parseUpscaleOptions(PATHS))).toMatchObject({
      model: { kind: 'pinned' },
      scale: 4,
    })
  })

  it('uses scale 1 for restoration models', () => {
    expect(
      resolveModel(
        parseUpscaleOptions({ ...PATHS, model: '1x-SaiyaJin-DeJpeg' }),
      ),
    ).toMatchObject({ model: { kind: 'pinned' }, scale: 1 })
  })
})

describe('the model catalogue', () => {
  it('covers every category and Upscayl’s own models', () => {
    const categories = new Set<string>()
    const names = new Set<string>()
    for (const model of modelManifest().models) {
      categories.add(model.category)
      names.add(model.name)
    }
    expect([...categories].sort()).toEqual([...MODEL_CATEGORIES].sort())
    for (const name of [
      'upscayl-standard-4x',
      'upscayl-lite-4x',
      'high-fidelity-4x',
      'digital-art-4x',
      'remacri-4x',
      'ultrasharp-4x',
      'realesr-animevideov3',
      DEFAULT_UPSCALE_MODEL,
    ]) {
      expect(names).toContain(name)
    }
  })
})
