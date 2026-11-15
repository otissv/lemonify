import { getJobs } from '@/features/jobs/job-functions'
import { isTerminal } from '@/server/jobs/job-types'
import type { JobView } from '@/server/services/job-service'

export const JOB_POLL_MS = 500

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

/**
 * Reads a Job until it ends, calling `onUpdate` each time its state or
 * progress changes. Returns the ended Job, or undefined when `signal` aborted
 * first (the Job itself carries on in the queue).
 */
export async function followJob(
  id: string,
  signal: AbortSignal,
  onUpdate?: (job: JobView) => void,
): Promise<JobView | undefined> {
  let last = ''
  while (!signal.aborted) {
    const [job] = await getJobs({ data: { ids: [id] } })
    if (signal.aborted) return undefined
    if (job === undefined) throw new Error('That job does not exist.')
    const snapshot = `${job.state}:${job.progress}`
    if (snapshot !== last) {
      last = snapshot
      onUpdate?.(job)
    }
    if (isTerminal(job.state)) return job
    await wait(JOB_POLL_MS, signal)
  }
  return undefined
}
