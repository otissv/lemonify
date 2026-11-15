// @vitest-environment node
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AiToolId } from '@/features/ai/ai-tools'

import { AiCancelledError, AiEngineError } from './ai-engine.ts'
import type { AiBatch } from './ai-engine.ts'
import { UpscaylCliEngine, nodeCliCommand } from './upscayl-cli-engine.ts'
import type { CliCommandBuilder } from './upscayl-cli-engine.ts'

const SETTINGS = {
  model: 'siax',
  scale: 4,
  iterations: 2,
  tta: true,
} as const

/** A stand-in for the image CLI: writes one PNG per staged image and prints what the real one prints. */
const SUCCESS = `
const fs = require('node:fs'); const path = require('node:path');
const job = JSON.parse(process.argv[1]);
process.stderr.write(JSON.stringify({ event: 'progress', fraction: 0.5 }) + '\\n');
process.stderr.write('engine noise\\n');
fs.mkdirSync(job.destination, { recursive: true });
const images = [];
for (const name of fs.readdirSync(job.source)) {
  const output = path.join(job.destination, path.parse(name).name + '.png');
  fs.writeFileSync(output, 'upscaled ' + name);
  images.push({ source: path.join(job.source, name), output, width: 80, height: 40 });
}
process.stderr.write(JSON.stringify({ event: 'progress', fraction: 1 }) + '\\n');
console.log(JSON.stringify({ command: 'upscale', result: { images } }));
`
const FAILURE = `
console.error(JSON.stringify({ error: { type: 'UpscaleEngineError', message: 'The GPU ran out of memory' } }));
process.exit(1);
`
const CRASH = `console.error('Segmentation fault'); process.exit(139);`
const HANG = `setInterval(() => undefined, 1000);`

function fakeCli(script: string): CliCommandBuilder {
  return (job) => ({
    executable: process.execPath,
    args: ['-e', script, JSON.stringify(job)],
  })
}

describe('UpscaylCliEngine', () => {
  let directory = ''
  let batch: AiBatch

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'lemonify-ai-'))
    const inputs: string[] = []
    for (const name of ['one', 'two']) {
      const file = path.join(directory, name)
      await sharp({
        create: { width: 4, height: 4, channels: 3, background: '#00f' },
      })
        .png()
        .toFile(file)
      inputs.push(file)
    }
    batch = {
      tool: AiToolId.Upscale,
      settings: SETTINGS,
      requests: inputs.map((input, index) => ({
        id: `img${index}`,
        input,
        output: path.join(directory, `img${index}.png`),
      })),
    }
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  function engine(script: string): UpscaylCliEngine {
    return new UpscaylCliEngine({
      workRoot: path.join(directory, 'work'),
      command: fakeCli(script),
    })
  }

  it('runs the batch as one process and moves each image where asked', async () => {
    const progress: number[] = []
    const running = engine(SUCCESS).run(batch, (fraction) =>
      progress.push(fraction),
    )
    const results = await running.result
    expect(results).toEqual([
      { id: 'img0', width: 80, height: 40 },
      { id: 'img1', width: 80, height: 40 },
    ])
    expect(await readFile(path.join(directory, 'img0.png'), 'utf8')).toMatch(
      /^upscaled img0\./,
    )
    expect(progress).toEqual([0.5, 1])
    expect(await readdir(path.join(directory, 'work'))).toEqual([])
  })

  it('reports the failure the CLI printed, in its own words', async () => {
    const failure = engine(FAILURE).run(batch, () => undefined).result
    await expect(failure).rejects.toThrow('The GPU ran out of memory')
    await expect(failure).rejects.toBeInstanceOf(AiEngineError)
  })

  it('reports a crash without a message in plain words', async () => {
    await expect(
      engine(CRASH).run(batch, () => undefined).result,
    ).rejects.toThrow('The AI step stopped unexpectedly.')
  })

  it('stops a running process when cancelled', async () => {
    const running = engine(HANG).run(batch, () => undefined)
    await new Promise((resolve) => setTimeout(resolve, 300))
    running.cancel()
    await expect(running.result).rejects.toBeInstanceOf(AiCancelledError)
    expect(await readdir(path.join(directory, 'work'))).toEqual([])
  })

  it('does not start when cancelled at once', async () => {
    const running = engine(HANG).run(batch, () => undefined)
    running.cancel()
    await expect(running.result).rejects.toBeInstanceOf(AiCancelledError)
  })

  it('fails when the CLI leaves an image out', async () => {
    const missing = `
      const job = JSON.parse(process.argv[1]);
      console.log(JSON.stringify({ result: { images: [] } }));`
    await expect(
      engine(missing).run(batch, () => undefined).result,
    ).rejects.toThrow('did not make every image')
  })

  it('refuses a tool it does not run', async () => {
    const other = { ...batch, tool: 'removeBackground' } as unknown as AiBatch
    await expect(
      engine(SUCCESS).run(other, () => undefined).result,
    ).rejects.toThrow(/cannot run/)
  })

  it('offers the model catalogue and its default for upscale', async () => {
    const { defaultModel, models } = await engine(SUCCESS).catalogue(
      AiToolId.Upscale,
    )
    expect(models.length).toBeGreaterThan(0)
    expect(models[0]).toHaveProperty('scales')
    expect(models.map(({ name }) => name)).toContain(defaultModel)
  })

  it('starts the real CLI with the loader flags and a JSON job', () => {
    const command = nodeCliCommand({ source: '/in', destination: '/out' })
    expect(command.executable).toBe(process.execPath)
    expect(command.args).toContain('--experimental-transform-types')
    expect(command.args).toContain('--import')
    expect(command.args).toEqual(
      expect.arrayContaining(['upscale', '--job', '--json', '--progress']),
    )
  })
})
