// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createTempDir, listFiles, removeDir } from '@/test/image-fixtures.ts'

import { ModelChecksumError, ModelDownloadError } from './errors.ts'
import { installModelFiles, modelInstallState } from './model-install.ts'
import type { Fetcher } from './model-install.ts'
import { modelManifest } from './upscale-models.ts'
import type { PinnedFile, PinnedModel } from './upscale-models.ts'

const URL_BASE = 'https://models.test/'

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex')
}

function pinned(name: string, content: string): PinnedFile {
  return {
    name,
    url: `${URL_BASE}${name}`,
    sha256: sha256(content),
    bytes: Buffer.byteLength(content),
  }
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
    const { fetcher } = fakeFetch({ [`${URL_BASE}a.bin`]: 'weights' })

    const results = await installModelFiles({
      directory,
      files: [pinned('a.bin', 'weights')],
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
      files: [pinned('a.bin', 'weights')],
      fetch: fetcher,
    })

    expect(requested).toEqual([])
    expect(results[0]?.downloaded).toBe(false)
  })

  it('replaces a corrupted file', async () => {
    await writeFile(path.join(directory, 'a.bin'), 'truncated')
    const { fetcher } = fakeFetch({ [`${URL_BASE}a.bin`]: 'weights' })

    await installModelFiles({
      directory,
      files: [pinned('a.bin', 'weights')],
      fetch: fetcher,
    })

    expect(await readFile(path.join(directory, 'a.bin'), 'utf8')).toBe(
      'weights',
    )
  })

  it('rejects a download whose checksum does not match and writes nothing', async () => {
    const { fetcher } = fakeFetch({ [`${URL_BASE}a.bin`]: 'tampered' })

    await expect(
      installModelFiles({
        directory,
        files: [pinned('a.bin', 'weights')],
        fetch: fetcher,
      }),
    ).rejects.toThrow(ModelChecksumError)
    expect(await listFiles(directory)).toEqual([])
  })

  it('reports failed downloads with the URL and status', async () => {
    const { fetcher } = fakeFetch({})

    const install = installModelFiles({
      directory,
      files: [pinned('a.bin', 'weights')],
      fetch: fetcher,
    })

    await expect(install).rejects.toThrow(ModelDownloadError)
    await expect(install).rejects.toThrow(`${URL_BASE}a.bin`)
    await expect(install).rejects.toThrow('404')
  })
})

describe('modelInstallState', () => {
  let root = ''
  const model: PinnedModel = {
    name: 'demo',
    source: 'opencomic',
    category: 'upscale',
    description: 'Demo',
    directory: 'upscale/models',
    scales: [4],
    noise: null,
    files: [pinned('demo.param', 'p'), pinned('demo.bin', 'weights')],
  }

  beforeEach(async () => {
    root = await createTempDir('model-state')
  })

  afterEach(async () => {
    await removeDir(root)
  })

  it('is missing, partial or installed by file presence and size', async () => {
    expect(await modelInstallState(root, model)).toBe('missing')
    const folder = path.join(root, 'upscale', 'models')
    await installModelFiles({
      directory: folder,
      files: [model.files[0]],
      fetch: fakeFetch({ [`${URL_BASE}demo.param`]: 'p' }).fetcher,
    })
    expect(await modelInstallState(root, model)).toBe('partial')
    await writeFile(path.join(folder, 'demo.bin'), 'weights')
    expect(await modelInstallState(root, model)).toBe('installed')
  })
})

describe('the pinned manifest', () => {
  it.each(modelManifest().models.map((model) => [model.name, model] as const))(
    '%s pins a .param and .bin pair for every file',
    (_name, model) => {
      const names: string[] = []
      for (const file of model.files) names.push(file.name)
      for (const name of names) {
        const pair = name.endsWith('.bin')
          ? name.replace(/\.bin$/, '.param')
          : name.replace(/\.param$/, '.bin')
        expect(names).toContain(pair)
      }
    },
  )
})
