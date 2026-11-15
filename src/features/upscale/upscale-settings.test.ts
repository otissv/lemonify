import { describe, expect, it } from 'vitest'

import {
  UpscaleSettingsSchema,
  defaultUpscaleSettings,
  withModel,
} from '@/features/upscale/upscale-settings'
import type { UpscaleCatalogue } from '@/features/upscale/upscale-settings'

const CATALOGUE: UpscaleCatalogue = {
  defaultModel: 'siax',
  models: [
    {
      name: 'siax',
      category: 'upscale',
      description: 'NMKD Siax',
      scales: [2, 3, 4],
      noise: null,
    },
    {
      name: 'waifu',
      category: 'upscale',
      description: 'Waifu2x CUnet',
      scales: [2, 4, 8],
      noise: [-1, 0, 1, 2, 3],
    },
    {
      name: 'descreen',
      category: 'descreen',
      description: 'Descreen',
      scales: [1],
      noise: null,
    },
  ],
}

describe('defaultUpscaleSettings', () => {
  it('uses the default model at its largest scale, run once, without TTA', () => {
    expect(defaultUpscaleSettings(CATALOGUE)).toEqual({
      model: 'siax',
      scale: 4,
      noise: undefined,
      iterations: 1,
      tta: false,
    })
  })
})

describe('withModel', () => {
  const settings = defaultUpscaleSettings(CATALOGUE)

  it('keeps the scale when the new model offers it', () => {
    expect(
      withModel({ ...settings, scale: 2 }, CATALOGUE, 'waifu'),
    ).toMatchObject({ model: 'waifu', scale: 2 })
  })

  it('switches to the largest scale when the new model lacks the current one', () => {
    expect(
      withModel({ ...settings, scale: 3 }, CATALOGUE, 'waifu'),
    ).toMatchObject({ model: 'waifu', scale: 8 })
  })

  it('starts a model with noise levels at level 0', () => {
    expect(withModel(settings, CATALOGUE, 'waifu').noise).toBe(0)
  })

  it('drops the noise level for a model without noise levels', () => {
    const waifu = withModel(settings, CATALOGUE, 'waifu')

    expect(withModel(waifu, CATALOGUE, 'descreen')).toMatchObject({
      model: 'descreen',
      scale: 1,
      noise: undefined,
    })
  })

  it('throws for a model that is not in the catalogue', () => {
    expect(() => withModel(settings, CATALOGUE, 'missing')).toThrow(
      'Unknown upscale model "missing"',
    )
  })
})

describe('UpscaleSettingsSchema', () => {
  it('accepts the default settings', () => {
    const settings = defaultUpscaleSettings(CATALOGUE)

    expect(UpscaleSettingsSchema.parse(settings)).toEqual(settings)
  })

  it('rejects more than three passes', () => {
    expect(
      UpscaleSettingsSchema.safeParse({
        ...defaultUpscaleSettings(CATALOGUE),
        iterations: 4,
      }).success,
    ).toBe(false)
  })
})
