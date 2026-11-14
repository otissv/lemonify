// @vitest-environment node
import { stat } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createImage,
  createTempDir,
  listFiles,
  removeDir,
} from '@/test/image-fixtures.ts'

import { ImageOptionsError } from '../errors.ts'
import { SharpOperationError } from './errors.ts'
import { runSharpJob } from './job.ts'
import type { SharpJobInput } from './job.ts'

describe('runSharpJob', () => {
  let root = ''

  beforeEach(async () => {
    root = await createTempDir('sharp-job')
  })

  afterEach(async () => {
    await removeDir(root)
  })

  it('applies ops in order and writes the output with its info', async () => {
    const input = await createImage(path.join(root, 'in.jpg'), {
      width: 40,
      height: 20,
    })
    const output = path.join(root, 'out', 'result.webp')

    const results = await runSharpJob({
      input,
      output,
      ops: [
        { op: 'rotate', angle: 90 },
        { op: 'resize', width: 10 },
        { op: 'greyscale' },
        { op: 'webp', quality: 60 },
      ],
    })

    const metadata = await sharp(output).metadata()
    expect(metadata).toMatchObject({ format: 'webp', width: 10, height: 20 })
    expect(results).toEqual([
      {
        source: input,
        sourceBytes: expect.any(Number),
        outputs: [
          {
            file: output,
            written: true,
            info: expect.objectContaining({ format: 'webp', width: 10 }),
          },
        ],
      },
    ])
  })

  it('creates an image without an input file', async () => {
    const output = path.join(root, 'blank.png')

    await runSharpJob({
      output,
      options: {
        create: { width: 8, height: 6, channels: 4, background: '#ff000080' },
      },
    })

    expect(await sharp(output).metadata()).toMatchObject({
      width: 8,
      height: 6,
      hasAlpha: true,
    })
  })

  it('joins several inputs into a grid', async () => {
    const a = await createImage(path.join(root, 'a.png'), {
      width: 10,
      height: 10,
      format: 'png',
    })
    const b = await createImage(path.join(root, 'b.png'), {
      width: 10,
      height: 10,
      format: 'png',
    })
    const output = path.join(root, 'joined.png')

    await runSharpJob({
      input: [a, b],
      output,
      options: { join: { across: 2 } },
    })

    expect(await sharp(output).metadata()).toMatchObject({
      width: 20,
      height: 10,
    })
  })

  it('composites an overlay file', async () => {
    const base = await createImage(path.join(root, 'base.png'), {
      width: 20,
      height: 20,
      format: 'png',
    })
    const logo = await createImage(path.join(root, 'logo.png'), {
      width: 5,
      height: 5,
      format: 'png',
    })
    const output = path.join(root, 'stamped.png')

    await runSharpJob({
      input: base,
      output,
      ops: [
        { op: 'composite', images: [{ input: logo, gravity: 'southeast' }] },
      ],
    })

    expect(await sharp(output).metadata()).toMatchObject({ width: 20 })
  })

  it('processes a folder, naming outputs after the final format op', async () => {
    const source = path.join(root, 'photos')
    await createImage(path.join(source, 'a.jpg'), { width: 8, height: 8 })
    await createImage(path.join(source, 'nested', 'b.png'), {
      width: 8,
      height: 8,
      format: 'png',
    })
    const output = path.join(root, 'converted')

    const results = await runSharpJob({
      input: source,
      output,
      recursive: true,
      ops: [{ op: 'flip' }, { op: 'avif', quality: 50 }],
    })

    expect(await listFiles(output)).toEqual(['a.avif', 'nested/b.avif'])
    expect(results).toHaveLength(2)
  })

  it('writes Deep Zoom tiles', async () => {
    const input = await createImage(path.join(root, 'big.png'), {
      width: 600,
      height: 300,
      format: 'png',
    })
    const output = path.join(root, 'tiles', 'big.dz')

    await runSharpJob({ input, output, ops: [{ op: 'tile', size: 256 }] })

    expect((await stat(path.join(root, 'tiles', 'big.dzi'))).isFile()).toBe(
      true,
    )
  })

  it('names the failing op when Sharp rejects its arguments', async () => {
    const input = await createImage(path.join(root, 'in.png'), {
      width: 10,
      height: 10,
      format: 'png',
    })

    const run = runSharpJob({
      input,
      output: path.join(root, 'out.png'),
      ops: [{ op: 'flip' }, { op: 'resize', width: 5, position: 999 }],
    })

    await expect(run).rejects.toThrow(SharpOperationError)
    await expect(run).rejects.toThrow('ops[1] (resize)')
  })

  it('reports processing failures with the source file', async () => {
    const input = await createImage(path.join(root, 'in.png'), {
      width: 10,
      height: 10,
      format: 'png',
    })

    await expect(
      runSharpJob({
        input,
        output: path.join(root, 'out.png'),
        ops: [{ op: 'extract', left: 50, top: 50, width: 10, height: 10 }],
      }),
    ).rejects.toThrow(input)
  })

  it.each<[SharpJobInput, string]>([
    [{ output: 'out.png' }, 'neither an input nor create/text'],
    [
      {
        input: 'a.png',
        output: 'out.png',
        options: {
          create: { width: 1, height: 1, channels: 3, background: '#000' },
        },
      },
      'both an input and create',
    ],
    [
      { input: ['a.png', 'b.png'], output: 'out.png' },
      'several inputs without join',
    ],
  ])('rejects a job with %j (%s)', async (job) => {
    await expect(runSharpJob(job)).rejects.toThrow(ImageOptionsError)
  })
})
