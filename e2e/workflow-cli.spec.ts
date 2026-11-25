import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import path from 'node:path'

import { expect, test } from '@playwright/test'
import sharp from 'sharp'
import { z } from 'zod'

import { openZip } from '../src/server/bundle/zip.ts'
import {
  RunResult,
  RunsResult,
  SourceResult,
  WorkflowResult,
  WorkflowsResult,
  cliFailure,
  cliResult,
  images,
} from './cli.ts'
import { RUN_DIR } from './global-setup.ts'

/**
 * Every workflow command of the command line, run as its own process on a data
 * folder of its own, as a person or a script would. Each test goes on from the
 * one before, so they run in order.
 */
test.describe.configure({ mode: 'serial', timeout: 120_000 })

const PreviewResult = z.object({
  preview: z.object({
    path: z.string(),
    nodeId: z.string(),
    size: z.object({ width: z.number(), height: z.number() }),
  }),
})
const FilesResult = RunResult.extend({
  files: z.object({
    written: z.array(z.string()),
    skipped: z.array(z.string()),
    manifest: z.string().optional(),
  }),
})
const ResultFiles = z.object({
  files: z.object({
    written: z.array(z.string()),
    skipped: z.array(z.string()),
  }),
})
const ArchiveResult = z.object({
  archive: z.object({ path: z.string(), images: z.number() }),
})

let root = ''
let data = ''
let large = ''
let small = ''
let workflowId = ''
let failedRunId = ''
let doneRunId = ''

async function picture(
  name: string,
  width: number,
  height: number,
): Promise<string> {
  const file = path.join(root, name)
  await sharp({ create: { width, height, channels: 3, background: '#3366cc' } })
    .png()
    .toFile(file)
  return file
}

async function workflow(): Promise<z.infer<typeof WorkflowResult>['workflow']> {
  return (
    await cliResult(data, ['workflow', 'show', workflowId], WorkflowResult)
  ).workflow
}

test.beforeAll(() => {
  const testInfo = test.info()
  root = path.join(
    RUN_DIR,
    'workflow-cli',
    `${testInfo.workerIndex}-${Date.now()}`,
  )
  data = path.join(root, 'data')
  mkdirSync(root, { recursive: true })
})

test.afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

test('adds the images a workflow runs on', async () => {
  const added = await cliResult(
    data,
    ['source', 'add', await picture('large.png', 320, 240)],
    SourceResult,
  )
  large = added.source.id
  small = (
    await cliResult(
      data,
      ['source', 'add', await picture('small.png', 160, 120)],
      SourceResult,
    )
  ).source.id
  expect(added.source.fileName).toBe('large.png')
})

test('creates a workflow with its steps, input images and Output settings', async () => {
  const created = await cliResult(
    data,
    [
      'workflow',
      'create',
      'Crop photos',
      '--sources',
      `${large},${small}`,
      // small.png is too small for this area, so its image fails.
      '--steps',
      '[{"op":"extract","options":{"left":0,"top":0,"width":200,"height":150}}]',
      '--output',
      '{"format":"webp","options":{},"keepMetadata":false,"widths":[],"suffix":"-crop"}',
    ],
    WorkflowResult,
  )
  workflowId = created.workflow.id
  expect(created.workflow).toMatchObject({
    name: 'Crop photos',
    canvasSize: 'match-input',
    inputs: [large, small],
    output: { format: 'webp', suffix: '-crop' },
  })
  expect(
    created.workflow.pipeline.steps.map((step) => step.op ?? step.kind),
  ).toEqual(['image-layer', 'extract'])

  const listed = await cliResult(data, ['workflow', 'list'], WorkflowsResult)
  expect(listed.workflows.map(({ name }) => name)).toEqual(['Crop photos'])
  expect((await workflow()).inputs).toEqual([large, small])
})

test('changes the canvas size as a change undo and redo take back and forth', async () => {
  const fixed = await cliResult(
    data,
    ['workflow', 'update', workflowId, '--width', '640', '--height', '480'],
    WorkflowResult,
  )
  expect(fixed.workflow).toMatchObject({
    canvasSize: 'fixed',
    pipeline: { canvas: { width: 640, height: 480 } },
    canUndo: true,
  })

  const matched = await cliResult(
    data,
    ['workflow', 'update', workflowId, '--canvas-size', 'match-input'],
    WorkflowResult,
  )
  expect(matched.workflow.canvasSize).toBe('match-input')

  const undone = await cliResult(
    data,
    ['workflow', 'undo', workflowId],
    WorkflowResult,
  )
  expect(undone.workflow.canvasSize).toBe('fixed')
  const redone = await cliResult(
    data,
    ['workflow', 'redo', workflowId],
    WorkflowResult,
  )
  expect(redone.workflow).toMatchObject({
    canvasSize: 'match-input',
    canRedo: false,
  })
})

test('renames a workflow outside its Edit history', async () => {
  const renamed = await cliResult(
    data,
    ['workflow', 'rename', workflowId, 'Cropped photos'],
    WorkflowResult,
  )
  expect(renamed.workflow.name).toBe('Cropped photos')
  const undone = await cliResult(
    data,
    ['workflow', 'undo', workflowId],
    WorkflowResult,
  )
  expect(undone.workflow.name).toBe('Cropped photos')
  await cliResult(data, ['workflow', 'redo', workflowId], WorkflowResult)
})

test('takes input images out and puts them back', async () => {
  const without = await cliResult(
    data,
    ['workflow', 'update', workflowId, '--without', small],
    WorkflowResult,
  )
  expect(without.workflow.inputs).toEqual([large])
  const back = await cliResult(
    data,
    ['workflow', 'update', workflowId, '--sources', small],
    WorkflowResult,
  )
  expect(back.workflow.inputs).toEqual([large, small])
})

test('writes the large picture of a node', async () => {
  const canvas = await cliResult(
    data,
    [
      'workflow',
      'preview',
      workflowId,
      '--node',
      'canvas',
      '--out',
      path.join(root, 'canvas.png'),
    ],
    PreviewResult,
  )
  expect(canvas.preview).toMatchObject({
    nodeId: 'canvas',
    size: { width: 160, height: 120 },
  })
  expect(existsSync(canvas.preview.path)).toBe(true)

  const narrow = await cliResult(
    data,
    [
      'workflow',
      'preview',
      workflowId,
      '--node',
      'inputs',
      '--width',
      '80',
      '--out',
      path.join(root, 'inputs.webp'),
    ],
    PreviewResult,
  )
  expect((await sharp(narrow.preview.path).metadata()).width).toBe(80)

  // The preview draws the last input image, which is too small for the crop.
  const failed = await cliFailure(data, [
    'workflow',
    'preview',
    workflowId,
    '--out',
    path.join(root, 'output.png'),
  ])
  expect(failed.message).toContain('bad extract area')
})

test('runs here with --follow, writes the finished images with a manifest, and says which image failed', async () => {
  const out = path.join(root, 'out')
  const ran = await cliResult(
    data,
    ['workflow', 'run', workflowId, '--follow', '--out', out, '--manifest'],
    FilesResult,
  )
  const { run } = ran
  failedRunId = run.id
  expect(run.state).toBe('failed')
  expect(run.items.map(({ sourceId, state }) => [sourceId, state])).toEqual([
    [large, 'done'],
    [small, 'failed'],
  ])
  expect(run.errors.join(' ')).toContain('bad extract area')
  expect(readdirSync(out).sort()).toEqual(['large-crop.webp', 'manifest.json'])
  expect(
    await sharp(path.join(out, 'large-crop.webp')).metadata(),
  ).toMatchObject({ format: 'webp', width: 200, height: 150 })
  expect(readFileSync(path.join(out, 'manifest.json'), 'utf8')).toContain(
    'large-crop.webp',
  )
})

test('runs on chosen images only, and lists and shows the runs, newest first', async () => {
  const ran = await cliResult(
    data,
    ['workflow', 'run', workflowId, '--sources', large, '--follow'],
    RunResult,
  )
  doneRunId = ran.run.id
  expect(ran.run).toMatchObject({ state: 'done', sourceIds: [large] })

  const listed = await cliResult(
    data,
    ['workflow', 'runs', '--workflow', workflowId],
    RunsResult,
  )
  expect(listed.runs.map(({ id }) => id)).toEqual([doneRunId, failedRunId])
  const shown = await cliResult(
    data,
    ['workflow', 'run', 'show', failedRunId],
    RunResult,
  )
  expect(shown.run.items.map(({ state }) => state)).toEqual(['done', 'failed'])
})

test('writes a run’s images again, into a folder or one zip file', async () => {
  const folder = path.join(root, 'again')
  const first = await cliResult(
    data,
    ['workflow', 'results', failedRunId, '--out', folder],
    ResultFiles,
  )
  expect(first.files.written.map((file) => path.basename(file))).toEqual([
    'large-crop.webp',
  ])
  const second = await cliResult(
    data,
    ['workflow', 'results', failedRunId, '--out', folder, '--existing', 'skip'],
    ResultFiles,
  )
  expect(second.files).toMatchObject({ written: [] })
  expect(second.files.skipped).toHaveLength(1)

  const zipped = await cliResult(
    data,
    ['workflow', 'results', failedRunId, '--zip', path.join(root, 'run.zip')],
    ArchiveResult,
  )
  expect(zipped.archive.images).toBe(1)
  const archive = await openZip(zipped.archive.path)
  expect(archive.entries.map(({ name }) => name)).toEqual(['large-crop.webp'])
  await archive.close()
})

test('queues a run without --follow, stops it and deletes it', async () => {
  const queued = await cliResult(
    data,
    ['workflow', 'run', workflowId],
    RunResult,
  )
  expect(queued.run.state).toBe('running')

  const cancelled = await cliResult(
    data,
    ['workflow', 'cancel', queued.run.id],
    RunResult,
  )
  expect(cancelled.run.state).toBe('cancelled')
  expect(cancelled.run.items.map(({ state }) => state)).toEqual([
    'cancelled',
    'cancelled',
  ])

  await cliResult(
    data,
    ['workflow', 'run', 'delete', queued.run.id],
    z.unknown(),
  )
  const listed = await cliResult(data, ['workflow', 'runs'], RunsResult)
  expect(listed.runs.map(({ id }) => id)).not.toContain(queued.run.id)
})

test('refuses what it cannot do, with a message and a failing exit code', async () => {
  const refusals = [
    ['workflow', 'create', 'Bad size', '--canvas-size', 'huge'],
    [
      'workflow',
      'create',
      'Both',
      '--pipeline',
      '{"canvas":{"width":10,"height":10,"background":"transparent"},"steps":[]}',
      '--steps',
      '[]',
    ],
    ['workflow', 'run', workflowId, '--out', path.join(root, 'nope')],
    ['workflow', 'run', workflowId, '--sources', 'not-an-input'],
    [
      'workflow',
      'results',
      failedRunId,
      '--out',
      root,
      '--zip',
      path.join(root, 'x.zip'),
    ],
    ['workflow', 'show', 'no-such-workflow'],
  ]
  for (const argv of refusals) {
    const failed = await cliFailure(data, argv)
    expect(failed.code, argv.join(' ')).not.toBe(0)
    expect(failed.message, argv.join(' ')).not.toBe('')
  }
  expect((await workflow()).name).toBe('Cropped photos')
})

test('deletes a workflow and keeps its runs', async () => {
  await cliResult(data, ['workflow', 'delete', workflowId], z.unknown())
  const listed = await cliResult(data, ['workflow', 'list'], WorkflowsResult)
  expect(listed.workflows).toEqual([])
  const runs = await cliResult(data, ['workflow', 'runs'], RunsResult)
  expect(runs.runs.map(({ id }) => id)).toEqual([doneRunId, failedRunId])
  expect(runs.runs.every(({ workflowId: id }) => id === null)).toBe(true)
  expect((await images(data, ['workflow', 'show', workflowId])).code).not.toBe(
    0,
  )
})
