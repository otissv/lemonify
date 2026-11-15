import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { PROTECTED_CHAIN } from '@/server/http/chains'
import { appFor } from '@/server/http/server-fn-context'

import type { JobView } from '@/server/services/job-service'

const MAX_JOBS_PER_POLL = 200

/** The state of several Jobs at once, so the page polls with one request. */
export const getJobs = createServerFn({ method: 'POST' })
  .middleware(PROTECTED_CHAIN)
  .validator(
    z.object({ ids: z.array(z.string().min(1)).max(MAX_JOBS_PER_POLL) }),
  )
  .handler(async ({ context, data }): Promise<JobView[]> => {
    const { app, actor } = await appFor(context)
    const jobs: JobView[] = []
    for (const id of data.ids) jobs.push(await app.jobs.get(actor, id))
    return jobs
  })

export const listJobs = createServerFn({ method: 'GET' })
  .middleware(PROTECTED_CHAIN)
  .validator(
    z.object({
      documentId: z.string().optional(),
      workflowRunId: z.string().optional(),
      limit: z.number().int().min(1).max(MAX_JOBS_PER_POLL).optional(),
    }),
  )
  .handler(async ({ context, data }): Promise<JobView[]> => {
    const { app, actor } = await appFor(context)
    return app.jobs.list(actor, data)
  })

export const cancelJob = createServerFn({ method: 'POST' })
  .middleware(PROTECTED_CHAIN)
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ context, data }): Promise<JobView> => {
    const { app, actor } = await appFor(context)
    return app.jobs.cancel(actor, data.id)
  })
