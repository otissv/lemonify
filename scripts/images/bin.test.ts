// @vitest-environment node
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  createImage,
  createTempDir,
  removeDir,
} from '../../src/test/image-fixtures.ts'
import { MODELS_ROOT } from '../../src/lib/images/upscale-models.ts'

const run = promisify(execFile)
const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..')
const BIN_NAME = 'lemonify-images'

const packageSchema = z.object({
  bin: z.object({ [BIN_NAME]: z.string().min(1) }),
})

async function binPath(): Promise<string> {
  const manifest = packageSchema.parse(
    JSON.parse(await readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf8')),
  )
  return path.join(PROJECT_ROOT, manifest.bin[BIN_NAME])
}

describe('lemonify-images bin', () => {
  let directory = ''

  beforeEach(async () => {
    directory = await createTempDir('bin')
  })

  afterEach(async () => {
    await removeDir(directory)
  })

  it('is a Node script declared in package.json', async () => {
    const source = await readFile(await binPath(), 'utf8')
    expect(source.startsWith('#!/usr/bin/env node\n')).toBe(true)
  })

  it('prints help under its own name without Node warnings', async () => {
    const { stdout, stderr } = await run('node', [await binPath(), '--help'])
    expect(stdout.startsWith(`Usage: ${BIN_NAME} <command>`)).toBe(true)
    expect(stderr).toBe('')
  })

  it('resolves relative paths from the folder it is run in', async () => {
    await createImage(path.join(directory, 'a.png'), {
      width: 4,
      height: 4,
      format: 'png',
    })

    const { stdout } = await run(
      'node',
      [await binPath(), 'info', 'a.png', '--json'],
      { cwd: directory },
    )

    expect(JSON.parse(stdout)).toMatchObject({
      command: 'info',
      result: [{ file: path.join(directory, 'a.png') }],
    })
  })
})

describe('MODELS_ROOT', () => {
  it('is the project’s model folder wherever the CLI runs from', () => {
    expect(MODELS_ROOT).toBe(path.join(PROJECT_ROOT, '.tools/upscayl-models'))
  })
})
