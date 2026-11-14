// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createTempDir, listFiles, removeDir } from '@/test/image-fixtures.ts'

import { ModelChecksumError, ModelDownloadError } from './errors.ts'
import { installModelFiles } from './model-install.ts'
import type { Fetcher } from './model-install.ts'
import { UPSCALE_MODELS, modelFilesDirectory } from './upscale-models.ts'

const BASE_URL = 'https://models.test/upscale/'
const SHA256_PATTERN = /^[0-9a-f]{64}$/

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex')
}

function fakeFetch(bodies: Readonly<Partial<Record<string, string>>>): {
  fetcher: Fetcher
  requested: string[]
} {
  const requested: string[] = []
  const fetcher: Fetcher = async (url) => {
    requested.push(url)
    const body = bodies[url]
    if (body === undefined) return new Response('missing', { status: 404 })
    return new Response(body)
  }
  return { fetcher, requested }
}

describe('installModelFiles', () => {
  let directory = ''

  beforeEach(async () => {
    directory = await createTempDir('models')
  })

  afterEach(async () => {
    await removeDir(directory)
  })

  it('downloads missing files after verifying their checksums', async () => {
    const { fetcher } = fakeFetch({ [`${BASE_URL}a.bin`]: 'weights' })

    const results = await installModelFiles({
      directory,
      baseUrl: BASE_URL,
      files: [{ name: 'a.bin', sha256: sha256('weights') }],
      fetch: fetcher,
    })

    expect(await readFile(path.join(directory, 'a.bin'), 'utf8')).toBe(
      'weights',
    )
    expect(results).toEqual([
      { file: path.join(directory, 'a.bin'), downloaded: true },
    ])
  })

  it('skips files that are already present and valid', async () => {
    await writeFile(path.join(directory, 'a.bin'), 'weights')
    const { fetcher, requested } = fakeFetch({})

    const results = await installModelFiles({
      directory,
      baseUrl: BASE_URL,
      files: [{ name: 'a.bin', sha256: sha256('weights') }],
      fetch: fetcher,
    })

    expect(requested).toEqual([])
    expect(results[0]?.downloaded).toBe(false)
  })

  it('replaces a corrupted file', async () => {
    await writeFile(path.join(directory, 'a.bin'), 'truncated')
    const { fetcher } = fakeFetch({ [`${BASE_URL}a.bin`]: 'weights' })

    await installModelFiles({
      directory,
      baseUrl: BASE_URL,
      files: [{ name: 'a.bin', sha256: sha256('weights') }],
      fetch: fetcher,
    })

    expect(await readFile(path.join(directory, 'a.bin'), 'utf8')).toBe(
      'weights',
    )
  })

  it('rejects a download whose checksum does not match and writes nothing', async () => {
    const { fetcher } = fakeFetch({ [`${BASE_URL}a.bin`]: 'tampered' })

    await expect(
      installModelFiles({
        directory,
        baseUrl: BASE_URL,
        files: [{ name: 'a.bin', sha256: sha256('weights') }],
        fetch: fetcher,
      }),
    ).rejects.toThrow(ModelChecksumError)
    expect(await listFiles(directory)).toEqual([])
  })

  it('reports failed downloads with the URL and status', async () => {
    const { fetcher } = fakeFetch({})

    const install = installModelFiles({
      directory,
      baseUrl: BASE_URL,
      files: [{ name: 'a.bin', sha256: sha256('weights') }],
      fetch: fetcher,
    })

    await expect(install).rejects.toThrow(ModelDownloadError)
    await expect(install).rejects.toThrow(`${BASE_URL}a.bin`)
    await expect(install).rejects.toThrow('404')
  })
})

describe('UPSCALE_MODELS', () => {
  it.each(Object.entries(UPSCALE_MODELS))(
    '%s pins a SHA-256 for every .param and .bin pair',
    (_name, model) => {
      const names: string[] = []
      for (const file of model.files) {
        expect(file.sha256).toMatch(SHA256_PATTERN)
        names.push(file.name)
      }
      for (const name of names) {
        const pair = name.endsWith('.bin')
          ? name.replace(/\.bin$/, '.param')
          : name.replace(/\.param$/, '.bin')
        expect(names).toContain(pair)
      }
    },
  )

  it('stores model files where opencomic-ai-bin looks for them', () => {
    expect(modelFilesDirectory('/root')).toBe(
      path.join('/root', 'upscale', 'models'),
    )
  })
})
