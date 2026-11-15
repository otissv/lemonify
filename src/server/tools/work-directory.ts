import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'

/**
 * Runs `work` with a fresh empty folder under `root` and removes it after,
 * whether the work succeeds or not. The folder is on the same disk as the
 * stores, so finished files can be moved into them without a copy.
 */
export async function withWorkDirectory<T>(
  root: string,
  work: (directory: string) => Promise<T>,
): Promise<T> {
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(path.join(root, 'job-'))
  try {
    return await work(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/** Removes the entries of `root` that were last changed more than `maxAgeMs` ago; a missing `root` is fine. */
export async function removeOlderThan(
  root: string,
  maxAgeMs: number,
): Promise<void> {
  let names: string[]
  try {
    names = await readdir(root)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return
    }
    throw error
  }
  const cutoff = Date.now() - maxAgeMs
  for (const name of names) {
    const entry = path.join(root, name)
    const { mtimeMs } = await stat(entry)
    if (mtimeMs < cutoff) await rm(entry, { recursive: true, force: true })
  }
}
