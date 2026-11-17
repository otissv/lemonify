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
    expect(added.document.pipeline.steps).toHaveLength(2)

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
    expect(undone.document.pipeline.steps).toHaveLength(1)
    const redone = await cli<Doc>('document', 'redo', document.id)
    expect(redone.document.pipeline.steps).toHaveLength(2)

    const listed = await cli<{ results: unknown[] }>('result', 'list')
    expect(listed.results).toHaveLength(1)
  })
})

describe('document files through the CLI', () => {
  it('exports a document to a file and imports it as a new document', async () => {
    const image = await makeImage('dog.png')
    const { source } = await cli<{ source: { id: string } }>(
      'source',
      'add',
      image,
    )
    const { document } = await cli<Doc>('document', 'create', source.id)
    await cli<Doc>(
      'document',
      'step',
      'add',
      document.id,
      '--op',
      'rotate',
      '--options',
      '{"angle":90}',
    )

    const folder = await cli<{ path: string; sources: number }>(
      'document',
      'export',
      document.id,
      '--out',
      workDir,
    )
    expect(folder.path).toBe(path.join(workDir, 'dog.lemon'))
    expect(folder.sources).toBe(1)
    expect(existsSync(folder.path)).toBe(true)

    const imported = await cli<Doc>('document', 'import', folder.path)
    expect(imported.document.id).not.toBe(document.id)
    expect(imported.document.pipeline.steps).toHaveLength(2)

    const listed = await cli<{ documents: unknown[] }>('document', 'list')
    expect(listed.documents).toHaveLength(2)
  })
})

describe('layers through the CLI', () => {
  async function pixel(file: string, x: number, y: number): Promise<number[]> {
    const { data, info } = await sharp(file)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const start = (y * info.width + x) * info.channels
    return [...data.subarray(start, start + info.channels)]
  }

  it('blends a half-transparent layer into the document’s image where it lies, and leaves the rest alone', async () => {
    const base = await cli<{ source: { id: string } }>(
      'source',
      'add',
      await makeImage('base.png'),
    )
    const stamp = path.join(workDir, 'stamp.png')
    await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 4,
        background: { r: 0, g: 0, b: 255, alpha: 0.5 },
      },
    })
      .png()
      .toFile(stamp)
    const { source } = await cli<{ source: { id: string } }>(
      'source',
      'add',
      stamp,
    )
    const { document } = await cli<Doc>('document', 'create', base.source.id)
    await cli<Doc>(
      'document',
      'step',
      'add',
      document.id,
      '--layer',
      source.id,
      '--settings',
      '{"fit":"original","anchor":"northwest"}',
    )

    const out = path.join(workDir, 'layered.png')
    await cli('export', document.id, '--out', out, '--format', 'png')

    const [r, g, b, a] = await pixel(out, 4, 4)
    expect(a).toBe(255)
    expect([r, g, b]).toEqual([110, 25, 153])
    expect(await pixel(out, 40, 40)).toEqual([221, 51, 51, 255])

    const [canvas] = document.pipeline.steps
    await cli('document', 'step', 'disable', document.id, canvas?.id ?? '')
    const alone = path.join(workDir, 'alone.png')
    await cli('export', document.id, '--out', alone, '--format', 'png')
    const meta = await sharp(alone).metadata()
    expect([meta.width, meta.height]).toEqual([16, 16])
  })
})

describe('blend, scale and opacity through the CLI', () => {
  async function pixel(file: string, x: number, y: number): Promise<number[]> {
    const { data, info } = await sharp(file)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const start = (y * info.width + x) * info.channels
    return [...data.subarray(start, start + info.channels)]
  }

  async function documentOf(): Promise<Doc['document']> {
    const base = await cli<{ source: { id: string } }>(
      'source',
      'add',
      await makeImage('flat.png'),
    )
    const { document } = await cli<Doc>('document', 'create', base.source.id)
    return document
  }

  it('blends a colour step with the picture before it, and can take the blend off', async () => {
    const document = await documentOf()
    const added = await cli<Doc>(
      'document',
      'step',
      'add',
      document.id,
      '--op',
      'negate',
      '--blend',
      '{"mode":"normal","opacity":50}',
    )
    const step = added.document.pipeline.steps.at(-1)
    expect(step).toMatchObject({
      op: 'negate',
      blend: { mode: 'normal', opacity: 50 },
    })

    const out = path.join(workDir, 'blended.png')
    await cli('export', document.id, '--out', out, '--format', 'png')
    const [r, g, b] = await pixel(out, 4, 4)
    expect([r, g, b]).toEqual([127, 127, 127])
    expect(Math.abs(g - 127)).toBeLessThanOrEqual(2)
    expect(Math.abs(b - 127)).toBeLessThanOrEqual(2)

    const cleared = await cli<Doc>(
      'document',
      'step',
      'set',
      document.id,
      step?.id ?? '',
      '--blend',
      '{}',
    )
    expect(cleared.document.pipeline.steps.at(-1)).not.toHaveProperty('blend')
  })

  it('refuses a blend on a step that cannot have one', async () => {
    const document = await documentOf()
    await expect(
      cli(
        'document',
        'step',
        'add',
        document.id,
        '--op',
        'resize',
        '--options',
        '{"width":8}',
        '--blend',
        '{"opacity":50}',
      ),
    ).rejects.toThrow(/blend/i)
  })

  it('scales the picture by a percentage and fades it with the opacity tool', async () => {
    const document = await documentOf()
    await cli(
      'document',
      'step',
      'add',
      document.id,
      '--op',
      'scale',
      '--options',
      '{"percent":50}',
    )
    await cli(
      'document',
      'step',
      'add',
      document.id,
      '--op',
      'opacity',
      '--options',
      '{"percent":50}',
    )
    const out = path.join(workDir, 'scaled.png')
    await cli('export', document.id, '--out', out, '--format', 'png')
    const meta = await sharp(out).metadata()
    expect([meta.width, meta.height]).toEqual([32, 24])
    const [, , , a] = await pixel(out, 4, 4)
    expect(Math.abs(a - 128)).toBeLessThanOrEqual(2)
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

  it('opens a second image as a pipeline step and swaps it', async () => {
    const base = await cli<{ source: { id: string } }>(
      'source',
      'add',
      await makeImage('base.png'),
    )
    const mask = await cli<{ source: { id: string } }>(
      'source',
      'add',
      await makeImage('mask.png'),
    )
    const { document } = await cli<Doc>('document', 'create', base.source.id)
    expect(document.pipeline.steps).toHaveLength(1)

    const added = await cli<Doc>(
      'document',
      'step',
      'add',
      document.id,
      '--layer',
      mask.source.id,
      '--settings',
      '{"opacity":40,"blend":"multiply"}',
    )
    const layer = added.document.pipeline.steps.at(-1)
    expect(added.document.pipeline.steps).toHaveLength(2)
    expect(layer).toMatchObject({
      kind: 'layer',
      sourceId: mask.source.id,
      opacity: 40,
      blend: 'multiply',
      fit: 'inside',
      anchor: 'centre',
    })

    const restyled = await cli<Doc>(
      'document',
      'step',
      'set',
      document.id,
      layer?.id ?? '',
      '--settings',
      '{"rotation":90,"anchor":"north"}',
    )
    expect(restyled.document.pipeline.steps.at(-1)).toMatchObject({
      kind: 'layer',
      opacity: 100,
      rotation: 90,
      anchor: 'north',
    })

    const swapped = await cli<Doc>(
      'document',
      'step',
      'set',
      document.id,
      layer?.id ?? '',
      '--source',
      base.source.id,
    )
    expect(swapped.document.pipeline.steps.at(-1)).toMatchObject({
      kind: 'layer',
      sourceId: base.source.id,
    })

    const renamed = await cli<Doc>(
      'document',
      'step',
      'rename',
      document.id,
      layer?.id ?? '',
      'Watermark',
    )
    expect(renamed.document.pipeline.steps.at(-1)).toMatchObject({
      name: 'Watermark',
    })

    const first = swapped.document.pipeline.steps.at(0)
    const replaced = await cli<Doc>(
      'document',
      'step',
      'set',
      document.id,
      first?.id ?? '',
      '--source',
      mask.source.id,
    )
    expect(replaced.document.pipeline.steps.at(0)).toMatchObject({
      kind: 'layer',
      sourceId: mask.source.id,
    })

    const removed = await cli<Doc>(
      'document',
      'step',
      'remove',
      document.id,
      first?.id ?? '',
    )
    expect(removed.document.pipeline.steps).toHaveLength(1)
    const emptied = await cli<Doc>(
      'document',
      'step',
      'remove',
      document.id,
      layer?.id ?? '',
    )
    expect(emptied.document.pipeline.steps).toHaveLength(0)
  })
})

describe('naming and ordering documents through the CLI', () => {
  it('renames a document and moves it in the list', async () => {
    const first = await cli<{ source: { id: string } }>(
      'source',
      'add',
      await makeImage('one.png'),
    )
    const second = await cli<{ source: { id: string } }>(
      'source',
      'add',
      await makeImage('two.png'),
    )
    const { document: a } = await cli<Doc>(
      'document',
      'create',
      first.source.id,
    )
    const { document: b } = await cli<Doc>(
      'document',
      'create',
      second.source.id,
    )

    const renamed = await cli<{ document: { name: string } }>(
      'document',
      'rename',
      b.id,
      'Poster',
    )
    expect(renamed.document.name).toBe('Poster')

    const before = await cli<{ documents: Array<{ id: string }> }>(
      'document',
      'list',
    )
    const to = before.documents.findIndex(({ id }) => id === a.id) === 0 ? 1 : 0
    const moved = await cli<{ documents: Array<{ id: string }> }>(
      'document',
      'move',
      a.id,
      String(to),
    )
    expect(moved.documents[to]?.id).toBe(a.id)
  })
})

describe('looking at a document through the CLI', () => {
  async function newDoc(): Promise<string> {
    const { source } = await cli<{ source: { id: string } }>(
      'source',
      'add',
      await makeImage('look.png'),
    )
    return (await cli<Doc>('document', 'create', source.id)).document.id
  }

  type Preview = {
    path: string
    bytes: number
    format: string
    original: boolean
    pending: string[]
    problems: unknown[]
  }

  it('writes the picture the canvas shows with `document preview`', async () => {
    const id = await newDoc()
    await cli<Doc>('document', 'step', 'add', id, '--op', 'flop')
    const file = path.join(workDir, 'canvas.png')

    const { preview } = await cli<{ preview: Preview }>(
      'document',
      'preview',
      id,
      '--out',
      file,
    )

    expect(preview).toMatchObject({
      path: file,
      format: 'png',
      original: false,
      pending: [],
      problems: [],
    })
    expect((await sharp(file).metadata()).format).toBe('png')
  })

  it('writes the image as opened, smaller, with --original and --width', async () => {
    const id = await newDoc()
    await cli<Doc>(
      'document',
      'step',
      'add',
      id,
      '--op',
      'rotate',
      '--options',
      '{"angle":90}',
    )
    const file = path.join(workDir, 'before.jpg')

    await cli(
      'document',
      'preview',
      id,
      '--out',
      file,
      '--original',
      '--width',
      '32',
    )

    const meta = await sharp(file).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 32, 24])
  })

  it('shows the result of an edit in the same command with --preview', async () => {
    const id = await newDoc()
    const file = path.join(workDir, 'after.png')

    const edited = await cli<Doc & { preview: Preview }>(
      'document',
      'step',
      'add',
      id,
      '--op',
      'rotate',
      '--options',
      '{"angle":90}',
      '--preview',
      file,
    )

    expect(edited.document.pipeline.steps).toHaveLength(2)
    expect(edited.preview.path).toBe(file)
    const meta = await sharp(file).metadata()
    expect([meta.width, meta.height]).toEqual([48, 64])
  })

  it('does the same after undo, so the change can be seen being taken back', async () => {
    const id = await newDoc()
    await cli<Doc>(
      'document',
      'step',
      'add',
      id,
      '--op',
      'rotate',
      '--options',
      '{"angle":90}',
    )
    const file = path.join(workDir, 'undone.png')

    const undone = await cli<Doc & { preview: Preview }>(
      'document',
      'undo',
      id,
      '--preview',
      file,
    )

    expect(undone.document.pipeline.steps).toHaveLength(1)
    const meta = await sharp(file).metadata()
    expect([meta.width, meta.height]).toEqual([64, 48])
  })

  it('writes no picture unless asked', async () => {
    const id = await newDoc()

    const edited = await cli<Doc & { preview?: Preview }>(
      'document',
      'step',
      'add',
      id,
      '--op',
      'flop',
    )

    expect(edited.preview).toBeUndefined()
  })
})

describe('looking at part of a document through the CLI', () => {
  it('writes only the region asked for with --region', async () => {
    const { source } = await cli<{ source: { id: string } }>(
      'source',
      'add',
      await makeImage('part.png'),
    )
    const { document } = await cli<Doc>('document', 'create', source.id)
    const file = path.join(workDir, 'part.png')

    const { preview } = await cli<{
      preview: { region: { x: number; width: number } }
    }>(
      'document',
      'preview',
      document.id,
      '--out',
      file,
      '--original',
      '--region',
      '0.5,0,0.5,1',
    )

    expect(preview.region).toEqual({ x: 0.5, y: 0, width: 0.5, height: 1 })
    expect(await sharp(file).metadata()).toMatchObject({
      width: 32,
      height: 48,
    })
  })

  it('refuses a region outside the picture', async () => {
    const { source } = await cli<{ source: { id: string } }>(
      'source',
      'add',
      await makeImage('bad.png'),
    )
    const { document } = await cli<Doc>('document', 'create', source.id)

    await expect(
      cli(
        'document',
        'preview',
        document.id,
        '--out',
        path.join(workDir, 'x.png'),
        '--region',
        '0.8,0,0.5,1',
      ),
    ).rejects.toThrow(/inside the picture/)
  })
})
