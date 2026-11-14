import path from 'node:path'

import { fileExists } from '../dry-run.ts'
import type { PlannedWrite, PlannedWriteKind, WritePlan } from '../dry-run.ts'
import { planTasks } from './job-plan.ts'
import type { SharpTask } from './job-plan.ts'
import type { SharpJob } from './job-schema.ts'
import { plannedVariantFiles } from './job-write.ts'

interface TaskFiles {
  reads: string[]
  writes: { file: string; kind: PlannedWriteKind }[]
}

function readsOf(source: string | string[] | null): string[] {
  if (source === null) return []
  return Array.isArray(source) ? source : [source]
}

async function taskFiles(task: SharpTask, job: SharpJob): Promise<TaskFiles> {
  if (task.kind === 'file')
    return {
      reads: readsOf(task.source),
      writes: [{ file: task.output, kind: 'file' }],
    }
  if (task.kind === 'inPlace')
    return {
      reads: [task.source],
      writes: [{ file: task.source, kind: 'inPlace' }],
    }
  const widths = job.variants?.widths ?? []
  const writes: TaskFiles['writes'] = []
  for (const file of await plannedVariantFiles(task, job, widths))
    writes.push({ file, kind: 'variant' })
  return { reads: [task.source], writes }
}

async function plannedWrite(
  file: string,
  source: PlannedWrite['source'],
  kind: PlannedWriteKind,
): Promise<PlannedWrite> {
  return { file, source, kind, exists: await fileExists(file) }
}

/**
 * Plans a validated job without writing anything: the same checks as a
 * real run (collisions, in-place formats, outputs over sources), then
 * every file it would read and write. Width variants run the pixel ops
 * in memory to learn the size they produce.
 */
export async function planValidatedSharpJob(job: SharpJob): Promise<WritePlan> {
  const plan: WritePlan = { dryRun: true, reads: [], writes: [] }
  for (const task of await planTasks(job)) {
    const { reads, writes } = await taskFiles(task, job)
    plan.reads.push(...reads)
    for (const write of writes)
      plan.writes.push(await plannedWrite(write.file, task.source, write.kind))
  }
  const manifest = job.variants?.manifest
  if (manifest !== undefined)
    plan.writes.push(
      await plannedWrite(path.resolve(manifest), null, 'manifest'),
    )
  return plan
}
