import { defineAppCommand } from '../app-command.ts'
import { z } from 'zod'

export const workerCommand = defineAppCommand({
  name: 'worker',
  summary: 'Take jobs from the queue until stopped',
  synopsis: '',
  help: `Runs the same job queue the web server runs, in this process, until Ctrl-C.
Use it to do queued work (for example \`workflow run\` without --follow) when no
server is running. Several workers and the server may run at once.`,
  shape: { quiet: z.boolean().default(false) },
  flags: { quiet: { type: 'boolean' } },
  async run({ app }) {
    await app.startBackground()
    await new Promise<void>((resolve) => {
      process.once('SIGINT', resolve)
      process.once('SIGTERM', resolve)
    })
    return { stopped: true }
  },
})
