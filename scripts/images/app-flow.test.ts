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
      '--image-layer',
      '--source',
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

    const [first] = document.pipeline.steps
    await cli('document', 'step', 'disable', document.id, first?.id ?? '')
    const alone = path.join(workDir, 'alone.png')
    await cli('export', document.id, '--out', alone, '--format', 'png')
    const meta = await sharp(alone).metadata()
    expect([meta.width, meta.height]).toEqual([64, 48])
    expect(await pixel(alone, 40, 40)).toEqual([0, 0, 0, 0])
    expect((await pixel(alone, 4, 4))[3]).toBe(128)
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

  it('writes the large picture of a node with `workflow preview`', async () => {
    const { source } = await cli<{ source: { id: string } }>(
      'source',
      'add',
      await makeImage('cat.png'),
    )
    const { workflow } = await cli<{
      workflow: { id: string; pipeline: { steps: Array<{ id: string }> } }
    }>(
      'workflow',
      'create',
      'Looked at',
      '--width',
      '64',
      '--height',
      '48',
      '--sources',
      source.id,
      '--steps',
      '[{"op":"flop"}]',
    )
    const flop = workflow.pipeline.steps.at(-1)
    const file = path.join(workDir, 'node.png')

    const { preview } = await cli<{
      preview: {
        path: string
        format: string
        nodeId: string
        size: { width: number; height: number } | null
      }
    }>(
      'workflow',
      'preview',
      workflow.id,
      '--out',
      file,
      '--node',
      flop?.id ?? '',
    )

    expect(preview).toMatchObject({
      path: file,
      format: 'png',
      nodeId: flop?.id,
      size: { width: 64, height: 48 },
    })
    expect((await sharp(file).metadata()).format).toBe('png')

    const output = await cli<{ preview: { nodeId: string } }>(
      'workflow',
      'preview',
      workflow.id,
      '--out',
      path.join(workDir, 'output.webp'),
    )
    expect(output.preview.nodeId).toBe('output')
  })

  it('makes a pipeline with a canvas and one empty image layer, and changes the canvas', async () => {
    const { workflow } = await cli<{
      workflow: {
        id: string
        pipeline: { canvas: unknown; steps: Array<{ kind: string }> }
      }
    }>('workflow', 'create', 'Sized', '--width', '300', '--height', '200')
    expect(workflow.pipeline.canvas).toEqual({
      width: 300,
      height: 200,
      background: 'transparent',
    })
    expect(workflow.pipeline.steps.map(({ kind }) => kind)).toEqual([
      'image-layer',
    ])

    const changed = await cli<{
      workflow: { pipeline: { canvas: unknown; steps: unknown[] } }
    }>('workflow', 'update', workflow.id, '--background', '#ff0000')
    expect(changed.workflow.pipeline.canvas).toEqual({
      width: 300,
      height: 200,
      background: '#ff0000',
    })
    expect(changed.workflow.pipeline.steps).toHaveLength(1)
  })

  it('renames a workflow, and undoes and redoes an update from its Edit history', async () => {
    const { workflow } = await cli<{ workflow: { id: string } }>(
      'workflow',
      'create',
      'Flow',
    )
    const renamed = await cli<{ workflow: { name: string } }>(
      'workflow',
      'rename',
      workflow.id,
      'Scaled',
    )
    expect(renamed.workflow.name).toBe('Scaled')

    const changed = await cli<{
      workflow: { canUndo: boolean; pipeline: { canvas: { width: number } } }
    }>('workflow', 'update', workflow.id, '--width', '640')
    expect(changed.workflow).toMatchObject({ canUndo: true })
    expect(changed.workflow.pipeline.canvas.width).toBe(640)

    const undone = await cli<{
      workflow: {
        canRedo: boolean
        pipeline: { canvas: { width: number } }
      }
    }>('workflow', 'undo', workflow.id)
    expect(undone.workflow.canRedo).toBe(true)
    expect(undone.workflow.pipeline.canvas.width).toBe(1920)

    const redone = await cli<{
      workflow: { pipeline: { canvas: { width: number } } }
    }>('workflow', 'redo', workflow.id)
    expect(redone.workflow.pipeline.canvas.width).toBe(640)
    await expect(cli('workflow', 'redo', workflow.id)).rejects.toThrow(
      /nothing to redo/i,
    )
  })

  it('takes images out of a workflow with --without, as one change that can be undone', async () => {
    const { source } = await cli<{ source: { id: string } }>(
      'source',
      'add',
      await makeImage('cat.png'),
    )
    const { workflow } = await cli<{ workflow: { id: string } }>(
      'workflow',
      'create',
      'Pair',
      '--sources',
      source.id,
    )
    const without = await cli<{ workflow: { inputs: string[] } }>(
      'workflow',
      'update',
      workflow.id,
      '--without',
      source.id,
    )
    expect(without.workflow.inputs).toEqual([])
    const undone = await cli<{ workflow: { inputs: string[] } }>(
      'workflow',
      'undo',
      workflow.id,
    )
    expect(undone.workflow.inputs).toEqual([source.id])
  })

  it('refuses --pipeline together with --steps or the canvas flags', async () => {
    await expect(
      cli(
        'workflow',
        'create',
        'Both',
        '--pipeline',
        '{"canvas":{"width":1,"height":1},"steps":[]}',
        '--width',
        '5',
      ),
    ).rejects.toThrow(/--pipeline on its own/)
  })

  it('runs on a canvas the size of each image with --canvas first-image', async () => {
    const { source } = await cli<{ source: { id: string } }>(
      'source',
      'add',
      await makeImage('wide.png'),
    )
    const { workflow } = await cli<{ workflow: { id: string } }>(
      'workflow',
      'create',
      'Own size',
      '--width',
      '999',
      '--height',
      '999',
      '--sources',
      source.id,
      '--output',
      JSON.stringify({
        format: 'png',
        options: {},
        keepMetadata: false,
        widths: [],
        suffix: '',
      }),
    )
    const folder = path.join(workDir, 'first-image')
    const ran = await cli<{ run: { state: string; canvasMode: string } }>(
      'workflow',
      'run',
      workflow.id,
      '--canvas',
      'first-image',
      '--follow',
      '--out',
      folder,
    )
    expect(ran.run).toMatchObject({ state: 'done', canvasMode: 'first-image' })
    const meta = await sharp(path.join(folder, 'wide.png')).metadata()
    const original = await sharp(await makeImage('wide2.png')).metadata()
    expect([meta.width, meta.height]).toEqual([original.width, original.height])
  })

  it('refuses a canvas mode it does not know', async () => {
    await expect(
      cli('workflow', 'run', 'nope', '--canvas', 'huge'),
    ).rejects.toThrow()
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
      '--image-layer',
      '--source',
      mask.source.id,
      '--settings',
      '{"opacity":40,"blend":"multiply"}',
    )
    const layer = added.document.pipeline.steps.at(-1)
    expect(added.document.pipeline.steps).toHaveLength(2)
    expect(layer).toMatchObject({
      kind: 'image-layer',
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
      kind: 'image-layer',
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
      kind: 'image-layer',
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
      kind: 'image-layer',
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

describe('groups through the CLI', () => {
  type Step = {
    id: string
    kind: string
    name?: string
    enabled: boolean
    steps?: Step[]
  }
  type GroupDoc = { document: { id: string; pipeline: { steps: Step[] } } }

  async function documentWithSteps() {
    const { source } = await cli<{ source: { id: string } }>(
      'source',
      'add',
      await makeImage('group.png'),
    )
    const { document } = await cli<Doc>('document', 'create', source.id)
    await cli('document', 'step', 'add', document.id, '--op', 'flip')
    const two = await cli<GroupDoc>(
      'document',
      'step',
      'add',
      document.id,
      '--op',
      'flop',
    )
    return two.document
  }

  it('groups, edits inside, moves in and out, switches, renames and ungroups', async () => {
    const document = await documentWithSteps()
    const [, flip, flop] = document.pipeline.steps

    const grouped = await cli<GroupDoc>(
      'document',
      'step',
      'group',
      document.id,
      `${flip?.id},${flop?.id}`,
      '--name',
      'Look',
    )
    const group = grouped.document.pipeline.steps.at(1)
    expect(group).toMatchObject({ kind: 'group', name: 'Look' })
    expect(group?.steps?.map(({ id }) => id)).toEqual([flip?.id, flop?.id])

    const added = await cli<GroupDoc>(
      'document',
      'step',
      'add',
      document.id,
      '--op',
      'negate',
      '--group',
      group?.id ?? '',
    )
    expect(added.document.pipeline.steps.at(1)?.steps).toHaveLength(3)

    const out = await cli<GroupDoc>(
      'document',
      'step',
      'move',
      document.id,
      flip?.id ?? '',
      '0',
    )
    expect(out.document.pipeline.steps.map(({ kind }) => kind)).toEqual([
      'sharp',
      'image-layer',
      'group',
    ])

    const into = await cli<GroupDoc>(
      'document',
      'step',
      'move',
      document.id,
      flip?.id ?? '',
      '0',
      '--into',
      group?.id ?? '',
    )
    expect(into.document.pipeline.steps.at(1)?.steps?.[0]?.id).toBe(flip?.id)

    const off = await cli<GroupDoc>(
      'document',
      'step',
      'disable',
      document.id,
      group?.id ?? '',
    )
    expect(off.document.pipeline.steps.at(1)?.enabled).toBe(false)

    const renamed = await cli<GroupDoc>(
      'document',
      'step',
      'rename',
      document.id,
      group?.id ?? '',
      'Finish',
    )
    expect(renamed.document.pipeline.steps.at(1)?.name).toBe('Finish')

    const ungrouped = await cli<GroupDoc>(
      'document',
      'step',
      'ungroup',
      document.id,
      group?.id ?? '',
    )
    expect(ungrouped.document.pipeline.steps.map(({ kind }) => kind)).toEqual([
      'image-layer',
      'sharp',
      'sharp',
      'sharp',
    ])

    const undone = await cli<GroupDoc>('document', 'undo', document.id)
    expect(undone.document.pipeline.steps.at(1)).toMatchObject({
      kind: 'group',
      name: 'Finish',
      enabled: false,
    })
  })

  it('makes a group a picture of its own, placed on the canvas, and back', async () => {
    const blue = path.join(workDir, 'blue.png')
    await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#00f' },
    })
      .png()
      .toFile(blue)
    const { source } = await cli<{ source: { id: string } }>(
      'source',
      'add',
      blue,
    )
    const document = await documentWithSteps()
    const added = await cli<GroupDoc>(
      'document',
      'step',
      'add',
      document.id,
      '--image-layer',
      '--source',
      source.id,
      '--settings',
      '{"fit":"original","anchor":"northwest"}',
    )
    const layer = added.document.pipeline.steps.at(-1)
    const grouped = await cli<GroupDoc>(
      'document',
      'step',
      'group',
      document.id,
      layer?.id ?? '',
      '--name',
      'Logo',
    )
    const group = grouped.document.pipeline.steps.at(-1)

    const sub = await cli<GroupDoc & { document: { pipeline: unknown } }>(
      'document',
      'step',
      'set',
      document.id,
      group?.id ?? '',
      '--sub-document',
      'on',
    )
    expect(sub.document.pipeline.steps.at(-1)).toMatchObject({
      kind: 'group',
      subDocument: true,
    })

    const placed = await cli<GroupDoc>(
      'document',
      'step',
      'set',
      document.id,
      group?.id ?? '',
      '--settings',
      '{"fit":"original","anchor":"northwest"}',
    )
    expect(placed.document.pipeline.steps.at(-1)).toMatchObject({
      fit: 'original',
      anchor: 'northwest',
    })

    const out = path.join(workDir, 'sub.png')
    await cli('export', document.id, '--out', out, '--format', 'png')
    const raw = await sharp(out).raw().ensureAlpha().toBuffer()
    const meta = await sharp(out).metadata()
    expect([meta.width, meta.height]).toEqual([64, 48])
    expect([...raw.subarray(0, 4)]).toEqual([0, 0, 255, 255])
    const far = (40 * 64 + 40) * 4
    expect([...raw.subarray(far, far + 4)]).toEqual([221, 51, 51, 255])

    const plain = await cli<GroupDoc>(
      'document',
      'step',
      'set',
      document.id,
      group?.id ?? '',
      '--sub-document',
      'off',
    )
    expect(plain.document.pipeline.steps.at(-1)).toMatchObject({
      subDocument: false,
    })

    await expect(
      cli('document', 'step', 'set', document.id, group?.id ?? ''),
    ).rejects.toThrow(/--sub-document or --settings/)
  })

  it('refuses steps that are not next to each other and a group inside a group', async () => {
    const document = await documentWithSteps()
    const [layer, , flop] = document.pipeline.steps
    await expect(
      cli('document', 'step', 'group', document.id, `${layer?.id},${flop?.id}`),
    ).rejects.toThrow()
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

  it('writes the picture a step acts on with `document preview --before-step`', async () => {
    const id = await newDoc()
    await cli<Doc>('document', 'step', 'add', id, '--op', 'flop')
    const added = await cli<Doc>(
      'document',
      'step',
      'add',
      id,
      '--op',
      'extract',
      '--options',
      '{"left":0,"top":0,"width":2,"height":2}',
    )
    const extract = added.document.pipeline.steps.at(-1)
    const file = path.join(workDir, 'before.png')

    const { preview } = await cli<{
      preview: Preview & { beforeStepId: string | null; size: unknown }
    }>(
      'document',
      'preview',
      id,
      '--out',
      file,
      '--before-step',
      extract?.id ?? '',
    )

    expect(preview.beforeStepId).toBe(extract?.id)
    expect(preview.size).toMatchObject({
      width: expect.any(Number),
      height: expect.any(Number),
    })
  })

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

describe('keys', () => {
  type Keys = {
    keybindings: {
      overrides: { bindings: Record<string, string[]> }
      effective: Record<string, string[]>
    }
  }

  it('lists the defaults, then shows a change, then goes back', async () => {
    const first = await cli<Keys>('keys', 'list')
    expect(first.keybindings.effective['edit.undo']).toEqual(['mod+z'])
    expect(first.keybindings.overrides.bindings).toEqual({})

    const set = await cli<Keys>('keys', 'set', 'view.fit', 'alt+z,alt+shift+z')
    expect(set.keybindings.effective['view.fit']).toEqual([
      'alt+z',
      'alt+shift+z',
    ])

    const unset = await cli<Keys>('keys', 'unset', 'edit.redo')
    expect(unset.keybindings.effective['edit.redo']).toEqual([])

    const one = await cli<Keys>('keys', 'reset', 'edit.redo')
    expect(one.keybindings.effective['edit.redo']).toEqual([
      'mod+shift+z',
      'mod+y',
    ])
    expect(one.keybindings.effective['view.fit']).toEqual([
      'alt+z',
      'alt+shift+z',
    ])

    const all = await cli<Keys>('keys', 'reset')
    expect(all.keybindings.overrides.bindings).toEqual({})
  })

  it('exports what was changed so it can be imported again', async () => {
    await cli('keys', 'set', 'view.fit', 'alt+z')
    const file = await cli<{
      version: number
      bindings: Record<string, string[]>
    }>('keys', 'export')
    expect(file).toEqual({ version: 1, bindings: { 'view.fit': ['alt+z'] } })

    await cli('keys', 'reset')
    const imported = await cli<Keys>(
      'keys',
      'import',
      '--bindings',
      JSON.stringify(file),
    )
    expect(imported.keybindings.effective['view.fit']).toEqual(['alt+z'])
  })

  it('refuses a key the browser keeps, a key another action has and an unknown action', async () => {
    await expect(cli('keys', 'set', 'view.fit', 'mod+w')).rejects.toThrow(
      /browser/,
    )
    await expect(cli('keys', 'set', 'view.fit', 'mod+z')).rejects.toThrow(
      /Undo/,
    )
    await expect(cli('keys', 'set', 'view.nope', 'alt+z')).rejects.toThrow(
      /no action "view.nope"/,
    )
    await expect(
      cli('keys', 'import', '--bindings', '{"version":2}'),
    ).rejects.toThrow()
    const after = await cli<Keys>('keys', 'list')
    expect(after.keybindings.overrides.bindings).toEqual({})
  })
})

describe('the canvas through the CLI', () => {
  type CanvasDoc = {
    document: {
      id: string
      pipeline: {
        canvas: { width: number; height: number; background: string }
        steps: Array<{ id: string }>
      }
    }
  }

  it('opens an image onto a canvas of its size, and makes a blank document on a canvas you size', async () => {
    const { source } = await cli<{ source: { id: string } }>(
      'source',
      'add',
      await makeImage('base.png'),
    )

    const opened = await cli<CanvasDoc>('document', 'create', source.id)
    expect(opened.document.pipeline.canvas).toEqual({
      width: 64,
      height: 48,
      background: 'transparent',
    })
    expect(opened.document.pipeline.steps).toHaveLength(1)

    const blank = await cli<CanvasDoc>(
      'document',
      'create',
      '--width',
      '20',
      '--height',
      '10',
      '--background',
      '#FF8800',
      '--name',
      'Banner',
    )
    expect(blank.document.pipeline.canvas).toEqual({
      width: 20,
      height: 10,
      background: '#ff8800',
    })
    expect(blank.document.pipeline.steps).toEqual([])
  })

  it('refuses a document that is neither from a source nor on a canvas, and mixes of the two', async () => {
    const { source } = await cli<{ source: { id: string } }>(
      'source',
      'add',
      await makeImage('base.png'),
    )

    await expect(cli('document', 'create')).rejects.toThrow(/--width/)
    await expect(
      cli('document', 'create', '--width', '20', '--height', '10'),
    ).rejects.toThrow(/--name/)
    await expect(
      cli('document', 'create', source.id, '--width', '20'),
    ).rejects.toThrow(/canvas from the image/)
    await expect(
      cli(
        'document',
        'create',
        '--width',
        '0',
        '--height',
        '10',
        '--name',
        'Bad',
      ),
    ).rejects.toThrow()
    await expect(
      cli(
        'document',
        'create',
        '--width',
        '20',
        '--height',
        '10',
        '--background',
        'red',
        '--name',
        'Bad',
      ),
    ).rejects.toThrow()
  })

  it('changes the canvas, keeps what is left out, undoes, and exports at the canvas size', async () => {
    const blank = await cli<CanvasDoc>(
      'document',
      'create',
      '--width',
      '20',
      '--height',
      '10',
      '--name',
      'Banner',
    )
    const { id } = blank.document

    const changed = await cli<CanvasDoc>(
      'document',
      'canvas',
      id,
      '--width',
      '30',
      '--background',
      '#00ff00',
    )
    expect(changed.document.pipeline.canvas).toEqual({
      width: 30,
      height: 10,
      background: '#00ff00',
    })

    const out = path.join(workDir, 'banner.png')
    await cli('export', id, '--out', out, '--format', 'png')
    const meta = await sharp(out).metadata()
    expect([meta.width, meta.height]).toEqual([30, 10])

    const undone = await cli<CanvasDoc>('document', 'undo', id)
    expect(undone.document.pipeline.canvas).toEqual({
      width: 20,
      height: 10,
      background: 'transparent',
    })
  })

  it('refuses a canvas that is too large or has a bad colour', async () => {
    const blank = await cli<CanvasDoc>(
      'document',
      'create',
      '--width',
      '20',
      '--height',
      '10',
      '--name',
      'Banner',
    )
    await expect(
      cli('document', 'canvas', blank.document.id, '--width', '70000'),
    ).rejects.toThrow()
    await expect(
      cli('document', 'canvas', blank.document.id, '--background', 'nope'),
    ).rejects.toThrow()
  })
})

describe('empty image layers through the CLI', () => {
  type LayerDoc = {
    document: {
      id: string
      source: { id: string } | null
      pipeline: {
        steps: Array<{ id: string; kind: string; sourceId?: string }>
      }
    }
  }

  async function blank(): Promise<LayerDoc['document']> {
    const { document } = await cli<LayerDoc>(
      'document',
      'create',
      '--width',
      '20',
      '--height',
      '10',
      '--name',
      'Blank',
    )
    return document
  }

  it('adds an empty image layer, fills it with an image, and empties it again', async () => {
    const { source } = await cli<{ source: { id: string } }>(
      'source',
      'add',
      await makeImage('base.png'),
    )
    const document = await blank()

    const added = await cli<LayerDoc>(
      'document',
      'step',
      'add',
      document.id,
      '--image-layer',
      '--settings',
      '{"opacity":40}',
    )
    const [empty] = added.document.pipeline.steps
    expect(empty).toMatchObject({ kind: 'image-layer', opacity: 40 })
    expect(empty).not.toHaveProperty('sourceId')
    expect(added.document.source).toBeNull()

    const filled = await cli<LayerDoc>(
      'document',
      'step',
      'set',
      document.id,
      empty?.id ?? '',
      '--source',
      source.id,
    )
    expect(filled.document.pipeline.steps[0]).toMatchObject({
      sourceId: source.id,
      opacity: 40,
    })
    expect(filled.document.source?.id).toBe(source.id)

    const emptied = await cli<LayerDoc>(
      'document',
      'step',
      'set',
      document.id,
      empty?.id ?? '',
      '--clear-source',
    )
    expect(emptied.document.pipeline.steps[0]).not.toHaveProperty('sourceId')
    expect(emptied.document.pipeline.steps[0]).toMatchObject({ opacity: 40 })
    expect(emptied.document.source).toBeNull()
  })

  it('exports a document whose only layer is empty as the blank canvas', async () => {
    const document = await blank()
    await cli('document', 'step', 'add', document.id, '--image-layer')

    const out = path.join(workDir, 'empty.png')
    await cli('export', document.id, '--out', out, '--format', 'png')

    const { data, info } = await sharp(out)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    expect([info.width, info.height]).toEqual([20, 10])
    expect([...data.subarray(0, 4)]).toEqual([0, 0, 0, 0])
  })

  it('refuses the flags that do not go together', async () => {
    const document = await blank()
    const added = await cli<LayerDoc>(
      'document',
      'step',
      'add',
      document.id,
      '--image-layer',
    )
    const layerId = added.document.pipeline.steps[0]?.id ?? ''

    await expect(
      cli(
        'document',
        'step',
        'add',
        document.id,
        '--op',
        'blur',
        '--source',
        'x',
      ),
    ).rejects.toThrow(/--source goes with --image-layer/)
    await expect(
      cli(
        'document',
        'step',
        'add',
        document.id,
        '--image-layer',
        '--op',
        'blur',
      ),
    ).rejects.toThrow(/Give one of/)
    await expect(
      cli(
        'document',
        'step',
        'set',
        document.id,
        layerId,
        '--source',
        'x',
        '--clear-source',
      ),
    ).rejects.toThrow(/not both/)
    await expect(
      cli('document', 'step', 'set', document.id, layerId),
    ).rejects.toThrow(/--settings, --source or --clear-source/)
  })
})

describe('resetting a step through the CLI', () => {
  type Step = { id: string; [key: string]: unknown }
  type StepDoc = { document: { id: string; pipeline: { steps: Step[] } } }

  async function documentWith(
    ...args: string[]
  ): Promise<{ id: string; step: Step }> {
    const base = await cli<{ source: { id: string } }>(
      'source',
      'add',
      await makeImage('reset.png'),
    )
    const { document } = await cli<StepDoc>(
      'document',
      'create',
      base.source.id,
    )
    const added = await cli<StepDoc>(
      'document',
      'step',
      'add',
      document.id,
      ...args,
    )
    const step = added.document.pipeline.steps.at(-1)
    if (!step) throw new Error('no step')
    return { id: document.id, step }
  }

  it("puts a Sharp step's options and blend back as one change, which undo takes back", async () => {
    const { id, step } = await documentWith(
      '--op',
      'tint',
      '--options',
      '{"colour":"#00ff00"}',
      '--blend',
      '{"mode":"multiply","opacity":40}',
    )

    const reset = await cli<StepDoc>('document', 'step', 'reset', id, step.id)
    const after = reset.document.pipeline.steps.at(-1)
    expect(after).toMatchObject({ op: 'tint', options: { colour: '#ff0000' } })
    expect(after).not.toHaveProperty('blend')

    const undone = await cli<StepDoc>('document', 'undo', id)
    expect(undone.document.pipeline.steps.at(-1)).toMatchObject({
      options: { colour: '#00ff00' },
      blend: { mode: 'multiply', opacity: 40 },
    })
  })

  it('puts a resize back to the size of the picture it acts on', async () => {
    const { id, step } = await documentWith(
      '--op',
      'resize',
      '--options',
      '{"width":5}',
    )

    const reset = await cli<StepDoc>('document', 'step', 'reset', id, step.id)

    expect(reset.document.pipeline.steps.at(-1)).toMatchObject({
      op: 'resize',
      options: { width: 64, height: 48 },
    })
  })

  it('puts an image layer back to the default placement, keeping its image', async () => {
    const image = await cli<{ source: { id: string } }>(
      'source',
      'add',
      await makeImage('logo.png'),
    )
    const { id, step } = await documentWith(
      '--image-layer',
      '--source',
      image.source.id,
      '--settings',
      '{"opacity":30,"anchor":"southeast"}',
    )

    const reset = await cli<StepDoc>('document', 'step', 'reset', id, step.id)

    expect(reset.document.pipeline.steps.at(-1)).toMatchObject({
      sourceId: image.source.id,
      opacity: 100,
      anchor: 'centre',
    })
  })
})
