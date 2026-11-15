// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { PROGRESS_EVENT, defineCommand } from './cli.ts'
import type { ImageCommand } from './cli.ts'

const HALF = 0.5

function progressCommand(): ImageCommand {
  return defineCommand({
    name: 'demo',
    summary: 'Demo',
    usage: 'demo',
    schema: z.object({}),
    parse: () => ({ kind: 'run', options: {} }),
    run: (_options, context) => {
      context.onProgress?.(HALF)
      context.onProgress?.(1)
      return Promise.resolve('done')
    },
    format: (result) => result,
  })
}

describe('defineCommand progress', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes one JSON progress line to stderr per update with --progress', async () => {
    const written: Array<string> = []
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      written.push(String(chunk))
      return true
    })
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await progressCommand().execute([], { json: true, progress: true })

    expect(written).toEqual([
      `${JSON.stringify({ event: PROGRESS_EVENT, fraction: HALF })}\n`,
      `${JSON.stringify({ event: PROGRESS_EVENT, fraction: 1 })}\n`,
    ])
  })

  it('reports nothing without --progress', async () => {
    const write = vi.spyOn(process.stderr, 'write')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await progressCommand().execute([], { json: false, progress: false })

    expect(write).not.toHaveBeenCalled()
  })
})
