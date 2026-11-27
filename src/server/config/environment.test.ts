import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ValidationError } from '../errors'
import { readEnvironment } from './environment'

describe('readEnvironment', () => {
  let dir = ''

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'lemonify-env-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('adds the settings in the .env file of the directory', async () => {
    await writeFile(
      path.join(dir, '.env'),
      'POSTGRES_HOST=127.0.0.1\nPOSTGRES_PORT=5433\n',
    )
    expect(readEnvironment(dir, {})).toEqual({
      POSTGRES_HOST: '127.0.0.1',
      POSTGRES_PORT: '5433',
    })
  })

  it('lets a variable set in the environment win over the file', async () => {
    await writeFile(path.join(dir, '.env'), 'POSTGRES_PORT=5433\n')
    expect(readEnvironment(dir, { POSTGRES_PORT: '6000' })).toEqual({
      POSTGRES_PORT: '6000',
    })
  })

  it('uses the environment alone when there is no .env file', () => {
    expect(readEnvironment(dir, { PORT: '4000' })).toEqual({ PORT: '4000' })
  })

  it('refuses a .env file it cannot read, naming the file', async () => {
    await mkdir(path.join(dir, '.env'))
    expect(() => readEnvironment(dir, {})).toThrow(ValidationError)
    expect(() => readEnvironment(dir, {})).toThrow(/\.env/)
  })
})
