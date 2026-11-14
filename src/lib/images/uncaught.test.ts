// @vitest-environment node
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const run = promisify(execFile)
const MODULE_URL = new URL(
  path.join(import.meta.dirname, 'uncaught.ts'),
  'file:',
).href

/** Runs `body` in a fresh Node process, where a stray throw would really crash it. */
async function runScript(body: string): Promise<string> {
  const script = `import { captureUncaughtErrors } from ${JSON.stringify(MODULE_URL)}\n${body}`
  const { stdout } = await run(process.execPath, [
    '--disable-warning=ExperimentalWarning',
    '--input-type=module',
    '--eval',
    script,
  ])
  return stdout.trim()
}

describe('captureUncaughtErrors', () => {
  it('turns an error thrown from an event callback into a rejection', async () => {
    const output = await runScript(`
      try {
        await captureUncaughtErrors(() => new Promise(() => {
          setImmediate(() => { throw new Error('Invalid GPU Device') })
        }))
      } catch (error) {
        console.log('caught:' + error.message)
      }
      console.log('listeners:' + process.listenerCount('uncaughtException'))
    `)

    expect(output).toBe('caught:Invalid GPU Device\nlisteners:0')
  })

  it('resolves with the task result and removes its listener', async () => {
    const output = await runScript(`
      const value = await captureUncaughtErrors(async () => 'done')
      console.log(value + ':' + process.listenerCount('uncaughtException'))
    `)

    expect(output).toBe('done:0')
  })

  it('passes ordinary task rejections through', async () => {
    const output = await runScript(`
      await captureUncaughtErrors(async () => { throw new Error('exit 1') })
        .catch((error) => console.log('caught:' + error.message))
    `)

    expect(output).toBe('caught:exit 1')
  })
})
