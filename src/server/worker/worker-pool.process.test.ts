// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { WorkerPool } from '@/features/ai/ai-tools'
import { canvasOfSize } from '@/features/pipeline/canvas'
import { createPipeline } from '@/features/pipeline/pipeline'
import { CanvasSize, createWorkflow } from '@/features/workflows/workflow'

import { PostgresJobDao } from '../dao/postgres/job-dao'
import { RunState } from '../dao/workflow-dao'
import { MemoryLogger } from '../http/logger'
import { JobState } from '../jobs/job-types'
import { probeProcess } from '../jobs/process-identity'
import { createTestApp } from '../testing/test-app'
import type { TestApp } from '../testing/test-app'
import { forkWorker } from './fork-worker'
import { DEFAULT_SUPERVISOR_TIMING, WorkerSupervisor } from './supervisor'

const PROCESS_TIMEOUT = 90_000
const ORPHANED = /stopped before it finished/

let t: TestApp
let supervisor: WorkerSupervisor | undefined

beforeEach(async () => {
  t = await createTestApp()
})

afterEach(async () => {
  await supervisor?.stop()
  supervisor = undefined
  await t.close()
})

/** The web server's pool, forking real workers on the test app's database and data folder. */
async function startPool(cpuWorkers: number): Promise<WorkerSupervisor> {
  supervisor = new WorkerSupervisor({
    counts: { [WorkerPool.Cpu]: cpuWorkers, [WorkerPool.Gpu]: 1 },
    startWorker: forkWorker(t.app.config, { quiet: true }),
    queue: new PostgresJobDao(t.app.database),
    reapOrphans: () => t.app.scheduler.reapOrphans(),
    logger: new MemoryLogger(),
    timing: { ...DEFAULT_SUPERVISOR_TIMING, restartDelayMs: 100 },
  })
  await supervisor.start()
  return supervisor
}

function readyPids(pool: WorkerSupervisor): number[] {
  const pids: number[] = []
  for (const worker of pool.workers()) {
    if (worker.ready && worker.pid !== undefined) pids.push(worker.pid)
  }
  return pids
}

async function eventually(
  check: () => Promise<boolean> | boolean,
): Promise<void> {
  const deadline = Date.now() + PROCESS_TIMEOUT / 2
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

async function queuedPreview(colour: string): Promise<string> {
  const source = await t.uploadImage(t.ann, colour, `${colour.slice(1)}.png`)
  const document = await t.app.documents.create(t.ann, source.id)
  return (await t.app.renders.requestPreview(t.ann, document.id)).id
}

async function stateOf(id: string): Promise<JobState> {
  return (await t.app.jobs.get(t.ann, id)).state
}

/** A workflow run whose one job is marked as held by `pid`, as if that process had taken it. */
async function runHeldBy(
  pid: number,
): Promise<{ runId: string; jobId: string }> {
  const source = await t.uploadImage(t.ann, '#884422', 'run.png')
  const { pipeline, output } = createWorkflow('x')
  const workflow = await t.app.workflows.create(t.ann, 'Held', {
    pipeline: createPipeline(canvasOfSize(20, 10), pipeline.steps),
    canvasSize: CanvasSize.Fixed,
    inputs: [source.id],
    output,
  })
  const run = await t.app.workflows.run(t.ann, workflow.id)
  const [job] = await new PostgresJobDao(t.app.database).listActive({
    workflowRunId: run.id,
  })
  if (job === undefined) throw new Error('The run queued no job.')
  await new PostgresJobDao(t.app.database).claim(
    job.id,
    `${pid}@2026-01-01T00:00:00.000Z`,
    new Date().toISOString(),
  )
  return { runId: run.id, jobId: job.id }
}

describe('the web server’s worker pool', () => {
  it(
    'starts the configured number of CPU worker processes, which run the queued jobs',
    async () => {
      const pool = await startPool(2)
      await eventually(() => readyPids(pool).length === 2)

      const jobs = [
        await queuedPreview('#111111'),
        await queuedPreview('#222222'),
      ]
      pool.wake([WorkerPool.Cpu])

      await eventually(async () => {
        for (const id of jobs)
          if ((await stateOf(id)) !== JobState.Done) return false
        return true
      })
      expect(
        pool.workers().filter((worker) => worker.pool === WorkerPool.Cpu),
      ).toHaveLength(2)
      expect(
        pool.workers().some((worker) => worker.pool === WorkerPool.Gpu),
      ).toBe(false)
    },
    PROCESS_TIMEOUT,
  )

  it(
    'restarts a worker that is killed, fails the job it held and tells its owner, and runs the next job',
    async () => {
      // Held by the test runner, which is alive and not this process, until the worker is known.
      const held = await runHeldBy(process.ppid)
      const pool = await startPool(1)
      await eventually(() => readyPids(pool).length === 1)
      const [killed] = readyPids(pool)
      if (killed === undefined) throw new Error('No worker started.')
      await t.app
        .database('jobs')
        .where({ id: held.jobId })
        .update({ claimed_by: `${killed}@2026-01-01T00:00:00.000Z` })

      process.kill(killed, 'SIGKILL')

      await eventually(
        async () => (await stateOf(held.jobId)) === JobState.Failed,
      )
      expect((await t.app.jobs.get(t.ann, held.jobId)).error).toMatch(ORPHANED)
      expect((await t.app.workflows.getRun(t.ann, held.runId)).state).toBe(
        RunState.Failed,
      )
      expect(t.changes.eventsFor(t.ann.userId)).toContainEqual({
        type: 'workflows.changed',
      })

      await eventually(() => readyPids(pool).some((pid) => pid !== killed))
      const next = await queuedPreview('#333333')
      pool.wake([WorkerPool.Cpu])
      await eventually(async () => (await stateOf(next)) === JobState.Done)
    },
    PROCESS_TIMEOUT,
  )

  it(
    'stops every worker when it stops, and starts no other',
    async () => {
      const pool = await startPool(2)
      await eventually(() => readyPids(pool).length === 2)
      const pids = readyPids(pool)

      await pool.stop()

      expect(pool.workers()).toEqual([])
      for (const pid of pids) expect(probeProcess(pid)).toBe(false)
    },
    PROCESS_TIMEOUT,
  )
})
