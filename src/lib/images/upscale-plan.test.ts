// @vitest-environment node
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createImage,
  createTempDir,
  listFiles,
  removeDir,
} from '@/test/image-fixtures.ts'

import { ImageOptionsError, UpscaleTargetError } from './errors.ts'
import { planUpscale } from './upscale-plan.ts'
import { upscaleImages } from './upscale.ts'

describe('planUpscale', () => {
  let root = ''
  let source = ''
  let destination = ''
  let models = ''

  beforeEach(async () => {
    root = await createTempDir('upscale-plan')
    source = path.join(root, 'photos')
    destination = path.join(root, 'out')
    models = path.join(root, 'models')
  })

  afterEach(async () => {
    await removeDir(root)
  })

  it('lists outputs with their upscaled size and the model state, writing nothing', async () => {
    const portrait = await createImage(path.join(source, 'portrait.jpg'), {
      width: 20,
      height: 10,
      orientation: 6,
    })

    const plan = await planUpscale(
      {
        source,
        destination,
        model: 'realcugan',
        scale: 2,
        iterations: 2,
        ops: [{ op: 'webp' }],
      },
      models,
    )

    expect(plan).toEqual({
      dryRun: true,
      model: 'realcugan',
      scale: 2,
      iterations: 2,
      modelStatus: 'missing',
      reads: [portrait],
      writes: [
        {
          file: path.join(destination, 'portrait.webp'),
          source: portrait,
          kind: 'file',
          exists: false,
          upscaledWidth: 40,
          upscaledHeight: 80,
        },
      ],
    })
    expect(await listFiles(root)).toEqual(['photos/portrait.jpg'])
  })

  it('reports a custom model without checking it', async () => {
    await createImage(path.join(source, 'a.png'), {
      width: 4,
      height: 4,
      format: 'png',
    })

    const plan = await planUpscale(
      {
        source,
        destination,
        customModel: { directory: models, name: 'mine', scale: 3 },
      },
      models,
    )

    expect(plan).toMatchObject({
      model: 'mine',
      scale: 3,
      modelStatus: 'custom',
    })
    expect(plan.writes[0]).toMatchObject({ upscaledWidth: 12 })
  })

  it('still refuses to overwrite a source file', async () => {
    await createImage(path.join(source, 'a.png'), {
      width: 4,
      height: 4,
      format: 'png',
    })

    await expect(
      planUpscale({ source, destination: source }, models),
    ).rejects.toThrow(UpscaleTargetError)
  })
})

describe('upscaleImages with dryRun', () => {
  it('refuses, so a dry run can never write', async () => {
    await expect(
      upscaleImages({ source: 'a', destination: 'b', dryRun: true }, () =>
        Promise.reject(new Error('engine must not run')),
      ),
    ).rejects.toThrow(ImageOptionsError)
  })
})
