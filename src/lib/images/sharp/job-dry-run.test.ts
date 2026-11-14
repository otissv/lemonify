// @vitest-environment node
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createImage,
  createTempDir,
  listFiles,
  removeDir,
} from '@/test/image-fixtures.ts'

import { ImageOptionsError, OutputCollisionError } from '../errors.ts'
import { planSharpJob, runSharpJob } from './job.ts'

describe('planSharpJob', () => {
  let root = ''
  let source = ''
  let output = ''

  beforeEach(async () => {
    root = await createTempDir('dry-run')
    source = path.join(root, 'photos')
    output = path.join(root, 'out')
  })

  afterEach(async () => {
    await removeDir(root)
  })

  it('lists variants and the manifest, flags existing files, and writes nothing', async () => {
    const a = await createImage(path.join(source, 'a.jpg'), {
      width: 40,
      height: 20,
    })
    const existing = await createImage(path.join(output, 'a-20.webp'), {
      width: 2,
      height: 2,
      format: 'webp',
    })
    const manifest = path.join(output, 'manifest.json')

    const plan = await planSharpJob({
      input: source,
      output,
      variants: { widths: [20, 80], manifest },
      ops: [{ op: 'webp' }],
    })

    expect(plan).toEqual({
      dryRun: true,
      reads: [a],
      writes: [
        { file: existing, source: a, kind: 'variant', exists: true },
        {
          file: path.join(output, 'a-40.webp'),
          source: a,
          kind: 'variant',
          exists: false,
        },
        { file: manifest, source: null, kind: 'manifest', exists: false },
      ],
    })
    expect(await listFiles(output)).toEqual(['a-20.webp'])
  })

  it('names variants after the size the ops produce', async () => {
    const file = await createImage(path.join(source, 'wide.png'), {
      width: 60,
      height: 20,
      format: 'png',
    })

    const plan = await planSharpJob({
      input: file,
      output,
      variants: { widths: [10, 50] },
      ops: [{ op: 'extract', left: 0, top: 0, width: 30, height: 20 }],
    })

    const files: string[] = []
    for (const write of plan.writes) files.push(path.basename(write.file))
    expect(files).toEqual(['wide-10.png', 'wide-30.png'])
  })

  it('lists in-place rewrites without touching the files', async () => {
    const file = await createImage(path.join(source, 'a.png'), {
      width: 8,
      height: 8,
      format: 'png',
    })
    const before = await readFile(file)

    const plan = await planSharpJob({ input: source, inPlace: 'ifSmaller' })

    expect(plan.writes).toEqual([
      { file, source: file, kind: 'inPlace', exists: true },
    ])
    expect(await readFile(file)).toEqual(before)
  })

  it('plans a generated image with nothing to read', async () => {
    const file = path.join(output, 'blank.png')

    const plan = await planSharpJob({
      output: file,
      options: {
        create: { width: 2, height: 2, channels: 3, background: '#000' },
      },
    })

    expect(plan).toEqual({
      dryRun: true,
      reads: [],
      writes: [{ file, source: null, kind: 'file', exists: false }],
    })
  })

  it('still refuses clashing outputs', async () => {
    await createImage(path.join(source, 'a.jpg'), { width: 8, height: 8 })
    await createImage(path.join(source, 'a.png'), {
      width: 8,
      height: 8,
      format: 'png',
    })

    await expect(
      planSharpJob({ input: source, output, ops: [{ op: 'avif' }] }),
    ).rejects.toThrow(OutputCollisionError)
  })
})

describe('runSharpJob with dryRun', () => {
  it('refuses, so a dry run can never write', async () => {
    await expect(
      runSharpJob({ input: 'a.png', output: 'b.png', dryRun: true }),
    ).rejects.toThrow(ImageOptionsError)
  })
})
