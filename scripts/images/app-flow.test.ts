// @vitest-environment node
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { COMMANDS } from './commands/index.ts'
import { dispatch } from './dispatch.ts'

let dataDir = ''
let workDir = ''

beforeEach(() => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'lemonify-flow-data-'))
  workDir = mkdtempSync(path.join(os.tmpdir(), 'lemonify-flow-work-'))
  vi.stubEnv('LEMONIFY_DATA_DIR', dataDir)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  rmSync(dataDir, { recursive: true, force: true })
  rmSync(workDir, { recursive: true, force: true })
})

async function cli<T = Record<string, unknown>>(...argv: string[]): Promise<T> {
  const lines: string[] = []
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    lines.push(line)
  })
  const selected = dispatch(COMMANDS, [...argv, '--json'])
  if (selected.kind !== 'run') throw new Error('expected a command')
  await selected.command.execute(selected.argv, { json: true, progress: false })
  vi.restoreAllMocks()
  const parsed: { result: T } = JSON.parse(lines.join('\n'))
  return parsed.result
}

async function makeImage(name: string): Promise<string> {
  const file = path.join(workDir, name)
  await sharp({
    create: { width: 64, height: 48, channels: 3, background: '#d33' },
  })
    .png()
    .toFile(file)
  return file
}

type Doc = {
  document: {
    id: string
    revision: number
    pipeline: { steps: Array<{ id: string }> }
  }
}

describe('sources, documents and export through the CLI', () => {
  it('uploads an image, edits a document, undoes, and exports it', async () => {
    const image = await makeImage('cat.png')
    const { source } = await cli<{ source: { id: string } }>(
      'source',
      'add',
      image,
    )
    const { document } = await cli<Doc>('document', 'create', source.id)
    const added = await cli<Doc>(
      'document',
      'step',
      'add',
      document.id,
      '--op',
      'rotate',
      '--options',
      '{"angle":90}',
    )
    expect(added.document.pipeline.steps).toHaveLength(1)

    const out = path.join(workDir, 'out.png')
    const exported = await cli<{ path: string }>(
      'export',
      document.id,
      '--out',
      out,
      '--format',
      'png',
    )
    expect(exported.path).toBe(out)
    const meta = await sharp(out).metadata()
    expect([meta.width, meta.height]).toEqual([48, 64])

    const undone = await cli<Doc>('document', 'undo', document.id)
    expect(undone.document.pipeline.steps).toHaveLength(0)
    const redone = await cli<Doc>('document', 'redo', document.id)
    expect(redone.document.pipeline.steps).toHaveLength(1)

    const listed = await cli<{ results: unknown[] }>('result', 'list')
    expect(listed.results).toHaveLength(1)
  })
})

describe('workflows through the CLI', () => {
  it('runs a workflow with --follow and writes the images with a manifest', async () => {
    const { source } = await cli<{ source: { id: string } }>(
      'source',
      'add',
      await makeImage('dog.png'),
    )
    const { workflow } = await cli<{ workflow: { id: string } }>(
      'workflow',
      'create',
      'Small',
      '--sources',
      source.id,
      '--steps',
      '[{"op":"flop"}]',
      '--output',
      JSON.stringify({
        format: 'png',
        options: {},
        keepMetadata: false,
        widths: [16, 32],
        suffix: '',
      }),
    )
    const folder = path.join(workDir, 'made')
    const ran = await cli<{
      run: { state: string }
      files: { written: string[]; manifest?: string }
    }>(
      'workflow',
      'run',
      workflow.id,
      '--follow',
      '--out',
      folder,
      '--manifest',
    )
    expect(ran.run.state).toBe('done')
    expect(readdirSync(folder).sort()).toEqual([
      'dog-16.png',
      'dog-32.png',
      'manifest.json',
    ])
    expect(existsSync(path.join(folder, 'manifest.json'))).toBe(true)
  })

  it('refuses --out without --follow', async () => {
    await expect(
      cli('workflow', 'run', 'nope', '--out', path.join(workDir, 'x')),
    ).rejects.toThrow(/--follow/)
  })
})
