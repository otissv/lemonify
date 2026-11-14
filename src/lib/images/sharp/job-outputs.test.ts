// @vitest-environment node
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createImage,
  createTempDir,
  listFiles,
  removeDir,
} from '@/test/image-fixtures.ts'

import { ImageOptionsError, OutputCollisionError } from '../errors.ts'
import { InPlaceFormatError } from './errors.ts'
import { runSharpJob } from './job.ts'
import type { SharpJobInput } from './job.ts'

async function sizeOf(file: string): Promise<number> {
  return (await stat(file)).size
}

describe('sharp job variants', () => {
  let root = ''
  let source = ''
  let output = ''

  beforeEach(async () => {
    root = await createTempDir('variants')
    source = path.join(root, 'photos')
    output = path.join(root, 'out')
  })

  afterEach(async () => {
    await removeDir(root)
  })

  it('writes one file per width, never enlarging, named after the format', async () => {
    await createImage(path.join(source, 'a.jpg'), { width: 40, height: 20 })
    await createImage(path.join(source, 'nested', 'b.png'), {
      width: 12,
      height: 12,
      format: 'png',
    })

    const results = await runSharpJob({
      input: source,
      output,
      recursive: true,
      variants: { widths: [80, 10, 20] },
      ops: [{ op: 'webp', quality: 60 }],
    })

    expect(await listFiles(output)).toEqual([
      'a-10.webp',
      'a-20.webp',
      'a-40.webp',
      'nested/b-10.webp',
      'nested/b-12.webp',
    ])
    expect(results[0]?.outputs).toHaveLength(3)
    expect((await sharp(path.join(output, 'a-20.webp')).metadata()).width).toBe(
      20,
    )
  })

  it('applies the ops before the variant resize', async () => {
    const file = await createImage(path.join(source, 'wide.png'), {
      width: 60,
      height: 20,
      format: 'png',
    })

    await runSharpJob({
      input: file,
      output,
      variants: { widths: [10, 50] },
      ops: [{ op: 'extract', left: 0, top: 0, width: 30, height: 20 }],
    })

    expect(await listFiles(output)).toEqual(['wide-10.png', 'wide-30.png'])
  })

  it('writes a manifest keyed by source path', async () => {
    await createImage(path.join(source, 'a.jpg'), { width: 40, height: 20 })
    const manifest = path.join(output, 'manifest.json')

    await runSharpJob({
      input: source,
      output,
      variants: { widths: [20], manifest },
    })

    expect(JSON.parse(await readFile(manifest, 'utf8'))).toEqual({
      'a.jpg': {
        width: 40,
        height: 20,
        variants: [{ path: 'a-20.jpg', width: 20 }],
      },
    })
  })

  it('refuses two sources that would share output names', async () => {
    await createImage(path.join(source, 'a.jpg'), { width: 8, height: 8 })
    await createImage(path.join(source, 'a.png'), {
      width: 8,
      height: 8,
      format: 'png',
    })

    await expect(
      runSharpJob({
        input: source,
        output,
        variants: { widths: [4] },
        ops: [{ op: 'webp' }],
      }),
    ).rejects.toThrow(OutputCollisionError)
    await expect(
      runSharpJob({ input: source, output, ops: [{ op: 'avif' }] }),
    ).rejects.toThrow(OutputCollisionError)
  })
})

describe('sharp job in place', () => {
  let root = ''

  beforeEach(async () => {
    root = await createTempDir('in-place')
  })

  afterEach(async () => {
    await removeDir(root)
  })

  it('replaces a file only when the result is smaller', async () => {
    const big = await createImage(path.join(root, 'big.jpg'), {
      width: 200,
      height: 200,
      noise: true,
      quality: 100,
    })
    const tiny = await createImage(path.join(root, 'tiny.png'), {
      width: 4,
      height: 4,
      format: 'png',
    })
    const bigBefore = await sizeOf(big)
    const tinyBefore = await readFile(tiny)

    const results = await runSharpJob({
      input: root,
      inPlace: 'ifSmaller',
      formatOptions: { jpeg: { quality: 40 }, png: { compressionLevel: 0 } },
    })

    expect(await sizeOf(big)).toBeLessThan(bigBefore)
    expect(await readFile(tiny)).toEqual(tinyBefore)
    const written: Record<string, boolean | undefined> = {}
    for (const result of results) {
      written[path.basename(String(result.source))] = result.outputs[0]?.written
    }
    expect(written).toEqual({ 'big.jpg': true, 'tiny.png': false })
  })

  it('always replaces with inPlace always', async () => {
    const tiny = await createImage(path.join(root, 'tiny.png'), {
      width: 4,
      height: 4,
      format: 'png',
    })
    const before = await sizeOf(tiny)

    await runSharpJob({
      input: tiny,
      inPlace: 'always',
      formatOptions: { png: { compressionLevel: 0 } },
    })

    expect(await sizeOf(tiny)).not.toBe(before)
    expect((await sharp(tiny).metadata()).format).toBe('png')
  })

  it('refuses to change a file’s format in place', async () => {
    const file = await createImage(path.join(root, 'a.jpg'), {
      width: 8,
      height: 8,
    })

    await expect(
      runSharpJob({ input: file, inPlace: 'always', ops: [{ op: 'avif' }] }),
    ).rejects.toThrow(InPlaceFormatError)
  })
})

describe('sharp job formatOptions', () => {
  let root = ''

  beforeEach(async () => {
    root = await createTempDir('format-options')
  })

  afterEach(async () => {
    await removeDir(root)
  })

  it('encodes with the options for the output format when no format op is given', async () => {
    const input = await createImage(path.join(root, 'in.png'), {
      width: 16,
      height: 16,
      format: 'png',
    })
    const output = path.join(root, 'out.png')

    await runSharpJob({
      input,
      output,
      formatOptions: { png: { palette: true } },
    })

    expect((await sharp(output).metadata()).isPalette).toBe(true)
  })
})

describe('sharp job validation', () => {
  it.each<[SharpJobInput, string]>([
    [{ input: 'a.png' }, 'no output and not in place'],
    [
      { input: 'a.png', output: 'b.png', inPlace: 'always' },
      'in place with output',
    ],
    [
      { input: ['a.png', 'b.png'], inPlace: 'always', options: { join: {} } },
      'in place with several inputs',
    ],
    [
      {
        input: ['a.png', 'b.png'],
        output: 'out',
        options: { join: {} },
        variants: { widths: [10] },
      },
      'variants of joined inputs',
    ],
    [
      {
        input: 'a.png',
        output: 'out',
        variants: { widths: [10] },
        ops: [{ op: 'tile' }],
      },
      'variants with tiles',
    ],
    [
      { input: 'a.png', inPlace: 'always', ops: [{ op: 'tile' }] },
      'tiles in place',
    ],
  ])('rejects %j (%s)', async (job) => {
    await expect(runSharpJob(job)).rejects.toThrow(ImageOptionsError)
  })
})
