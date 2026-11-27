// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const SOURCE_ROOT = path.resolve(import.meta.dirname, '..')
/** Test helpers run from the source tree, never from the build. */
const TEST_ONLY = [path.join(SOURCE_ROOT, 'test')]
const NEAR_THIS_MODULE = /import\.meta\.(url|dirname|filename)/

function appModules(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (TEST_ONLY.includes(full)) continue
    if (entry.isDirectory()) found.push(...appModules(full))
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(full)
    }
  }
  return found
}

describe('the production build', () => {
  it('needs no file from beside a module, since the build moves modules and copies only what they import', () => {
    const offending: string[] = []
    for (const file of appModules(SOURCE_ROOT)) {
      if (NEAR_THIS_MODULE.test(readFileSync(file, 'utf8'))) {
        offending.push(path.relative(SOURCE_ROOT, file))
      }
    }
    expect(offending).toEqual([])
  })
})
