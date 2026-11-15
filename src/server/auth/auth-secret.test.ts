import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolveAuthSecret } from './auth-secret'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'lemonify-secret-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('resolveAuthSecret', () => {
  it('prefers the configured secret and writes nothing', () => {
    expect(resolveAuthSecret('c'.repeat(32), dir)).toBe('c'.repeat(32))
    expect(() => statSync(path.join(dir, 'auth-secret'))).toThrow()
  })

  it('creates a secret once, readable by its owner only', () => {
    const first = resolveAuthSecret(undefined, dir)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(resolveAuthSecret(undefined, dir)).toBe(first)
    expect(statSync(path.join(dir, 'auth-secret')).mode & 0o777).toBe(0o600)
  })

  it('creates the data directory when it is missing', () => {
    const nested = path.join(dir, 'a', 'b')
    expect(resolveAuthSecret(undefined, nested)).toHaveLength(64)
  })

  it('treats an empty file as missing and refuses to overwrite it quietly', () => {
    writeFileSync(path.join(dir, 'auth-secret'), '  \n')
    expect(() => resolveAuthSecret(undefined, dir)).toThrow()
  })
})
