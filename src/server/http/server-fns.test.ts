// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const SOURCE_ROOT = path.resolve(__dirname, '..', '..')
const CHAINS = [
  'PROTECTED_CHAIN',
  'PUBLIC_CHAIN',
  'protectedChain(',
  'publicChain(',
]

function sourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) files.push(...sourceFiles(full))
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry))
      files.push(full)
  }
  return files
}

describe('server functions', () => {
  it('each list one of the middleware chains, so the checks cannot be forgotten', () => {
    const offenders: string[] = []
    let count = 0
    for (const file of sourceFiles(SOURCE_ROOT)) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/createServerFn\(\{[^}]*\}\)/g)) {
        count += 1
        const after = text.slice(
          match.index + match[0].length,
          match.index + match[0].length + 80,
        )
        if (!CHAINS.some((chain) => after.includes(`.middleware(${chain}`))) {
          offenders.push(`${path.relative(SOURCE_ROOT, file)}: ${match[0]}`)
        }
      }
    }
    expect(count).toBeGreaterThan(0)
    expect(offenders).toEqual([])
  })
})
