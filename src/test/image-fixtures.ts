import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

import type { ImageFormat } from '@/lib/images/options.ts'

export interface FixtureImage {
  width: number
  height: number
  format?: ImageFormat
  quality?: number
  noise?: boolean
  orientation?: number
}

const NOISE = { type: 'gaussian', mean: 128, sigma: 60 } as const

export async function createImage(
  file: string,
  image: FixtureImage,
): Promise<string> {
  await mkdir(path.dirname(file), { recursive: true })
  const base = sharp({
    create: {
      width: image.width,
      height: image.height,
      channels: 3,
      background: '#888888',
      noise: image.noise ? NOISE : undefined,
    },
  })
  const oriented =
    image.orientation === undefined
      ? base
      : base.withMetadata({ orientation: image.orientation })
  await oriented
    .toFormat(image.format ?? 'jpeg', { quality: image.quality ?? 90 })
    .toFile(file)
  return file
}

export async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), `lemonify-${prefix}-`))
}

export async function removeDir(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true })
}

/** Every file under `directory`, as sorted POSIX paths relative to it. */
export async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  })
  const files: string[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const relative = path.relative(
      directory,
      path.join(entry.parentPath, entry.name),
    )
    files.push(relative.split(path.sep).join('/'))
  }
  return files.sort()
}
