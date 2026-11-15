import { z } from 'zod'

import { JobKind, JobState } from '../../../src/server/jobs/job-types.ts'
import { defineAppCommand } from '../app-command.ts'

const id = z.string().min(1)

export const jobListCommand = defineAppCommand({
  name: 'job list',
  summary: 'List your jobs',
  synopsis:
    '[--state <state>] [--kind <kind>] [--document <id>] [--run <id>] [--limit <n>]',
  help: `Lists queued, running and finished jobs, newest first.

Options:
  --state <state>      ${Object.values(JobState).join(', ')}
  --kind <kind>        ${Object.values(JobKind).join(', ')}
  --document <id>      Only this document's jobs
  --run <id>           Only this workflow run's jobs
  --limit <n>          At most this many (default: 50)`,
  shape: {
    state: z.enum(JobState).optional(),
    kind: z.enum(JobKind).optional(),
    document: id.optional(),
    run: id.optional(),
    limit: z.coerce.number().int().positive().default(50),
  },
  flags: {
    state: { type: 'string' },
    kind: { type: 'string' },
    document: { type: 'string' },
    run: { type: 'string' },
    limit: { type: 'string' },
  },
  async run({ app, actor, options }) {
    return {
      jobs: await app.jobs.list(actor, {
        state: options.state === undefined ? undefined : [options.state],
        kind: options.kind,
        documentId: options.document,
        workflowRunId: options.run,
        limit: options.limit,
      }),
    }
  },
})

export const jobShowCommand = defineAppCommand({
  name: 'job show',
  summary: 'Print one job',
  synopsis: '<id>',
  help: 'Prints a job: its state, progress, result and, if it failed, why.',
  shape: { id },
  positionals: ['id'],
  async run({ app, actor, options }) {
    return { job: await app.jobs.get(actor, options.id) }
  },
})

export const jobCancelCommand = defineAppCommand({
  name: 'job cancel',
  summary: 'Cancel a job',
  synopsis: '<id>',
  help: 'Drops a waiting job or asks a running one to stop. A finished job is left as it is.',
  shape: { id },
  positionals: ['id'],
  async run({ app, actor, options }) {
    return { job: await app.jobs.cancel(actor, options.id) }
  },
})
