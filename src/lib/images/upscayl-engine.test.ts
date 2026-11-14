// @vitest-environment node
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const run = promisify(execFile)
const ENGINE_URL = new URL(
  path.join(import.meta.dirname, 'upscayl-engine.ts'),
  'file:',
).href
const MODEL_NAME = 'fake-model'
const MODEL_SCALE = 4

/** Stands in for `upscayl-bin` on a machine with no usable GPU: it reports the error and exits at once. */
const FAILING_BINARY = `#!/bin/sh
echo "Error: Invalid GPU Device" >&2
exit 255
`

let root: string

/** Lays out a fake `opencomic-ai-bin` package whose bundled binary is `FAILING_BINARY`. */
async function createFakeLibraryRoot(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'upscayl-engine-'))
  const binaryDirectory = path.join(directory, 'linux', 'x64', 'upscayl')
  await mkdir(binaryDirectory, { recursive: true })
  const binary = path.join(binaryDirectory, 'upscayl-bin')
  await writeFile(binary, FAILING_BINARY)
  await chmod(binary, 0o755)
  const models = path.join(directory, 'models')
  await mkdir(models)
  await writeFile(path.join(models, `${MODEL_NAME}.param`), '')
  await writeFile(path.join(models, `${MODEL_NAME}.bin`), '')
  return directory
}

/** Runs `body` in a fresh Node process, where an unhandled stream error would really crash it. */
async function runScript(body: string): Promise<string> {
  const script = `import OpenComicAI from 'opencomic-ai-bin'
import { createUpscaylEngine } from ${JSON.stringify(ENGINE_URL)}
OpenComicAI.setDirname(${JSON.stringify(path.join(root, 'dist'))})
${body}`
  const { stdout } = await run(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      '--input-type=module',
      '--eval',
      script,
    ],
    { cwd: process.cwd() },
  )
  return stdout.trim()
}

beforeEach(async () => {
  root = await createFakeLibraryRoot()
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('createUpscaylEngine', () => {
  it.runIf(process.platform === 'linux')(
    'closes cleanly after upscayl-bin has exited with an error',
    async () => {
      const choice = {
        kind: 'custom',
        directory: path.join(root, 'models'),
        name: MODEL_NAME,
      }
      const pass = {
        input: path.join(root, 'in.png'),
        output: path.join(root, 'out.png'),
        model: choice,
        scale: MODEL_SCALE,
        tta: false,
        fp32: false,
      }
      const output = await runScript(`
        const engine = await createUpscaylEngine(
          ${JSON.stringify(root)},
          ${JSON.stringify(choice)},
          ${MODEL_SCALE},
        )
        try {
          await engine.upscale(${JSON.stringify(pass)})
        } catch (error) {
          console.log('failed:' + error.cause.message)
        } finally {
          await engine.close()
        }
        await new Promise((resolve) => setTimeout(resolve, 200))
        console.log('closed')
      `)

      expect(output).toBe(
        'failed:Invalid GPU Device (Model: fake-model)\nclosed',
      )
    },
  )
})
