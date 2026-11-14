import path from 'node:path'
import sharp from 'sharp'

import { createManifest, writeManifest } from '../manifest.ts'
import type { ManifestSource } from '../manifest.ts'
import { parseWithSchema } from '../validation.ts'
import { planTasks } from './job-plan.ts'
import type {
  FileTask,
  InPlaceTask,
  SharpTask,
  VariantTask,
} from './job-plan.ts'
import { sharpJobSchema } from './job-schema.ts'
import type { SharpJob, SharpJobInput, SharpSettings } from './job-schema.ts'
import {
  writeFileTask,
  writeInPlaceTask,
  writeVariantTask,
} from './job-write.ts'
import type { SharpJobResult } from './job-write.ts'

export { sharpJobSchema, sharpSettingsSchema } from './job-schema.ts'
export type { SharpJob, SharpJobInput } from './job-schema.ts'
export type { SharpJobOutput, SharpJobResult } from './job-write.ts'

function applySettings(settings: SharpSettings | undefined): void {
  if (!settings) return
  if (settings.concurrency !== undefined)
    sharp.concurrency(settings.concurrency)
  if (settings.cache !== undefined) sharp.cache(settings.cache)
  if (settings.simd !== undefined) sharp.simd(settings.simd)
  if (settings.block) sharp.block({ operation: settings.block })
  if (settings.unblock) sharp.unblock({ operation: settings.unblock })
}

async function runVariants(
  tasks: readonly VariantTask[],
  job: SharpJob,
  variants: NonNullable<SharpJob['variants']>,
): Promise<SharpJobResult[]> {
  const results: SharpJobResult[] = []
  const entries: ManifestSource[] = []
  for (const task of tasks) {
    const { result, manifest } = await writeVariantTask(
      task,
      job,
      variants.widths,
    )
    results.push(result)
    entries.push(manifest)
  }
  if (variants.manifest === undefined || tasks.length === 0) return results
  const { root, destination } = tasks[0]
  const manifest = createManifest(entries, root, destination)
  await writeManifest(path.resolve(variants.manifest), manifest)
  return results
}

function splitTasks(tasks: readonly SharpTask[]): {
  single: (FileTask | InPlaceTask)[]
  variants: VariantTask[]
} {
  const single: (FileTask | InPlaceTask)[] = []
  const variants: VariantTask[] = []
  for (const task of tasks) {
    if (task.kind === 'variants') variants.push(task)
    else single.push(task)
  }
  return { single, variants }
}

function runSingle(
  task: FileTask | InPlaceTask,
  job: SharpJob,
): Promise<SharpJobResult> {
  return task.kind === 'file'
    ? writeFileTask(task, job)
    : writeInPlaceTask(task, job)
}

/** Validates and runs a Sharp job; folder inputs produce one result per image. */
export async function runSharpJob(
  input: SharpJobInput,
): Promise<SharpJobResult[]> {
  const job = parseWithSchema(sharpJobSchema, input)
  applySettings(job.settings)
  const { single, variants } = splitTasks(await planTasks(job))
  if (job.variants) return runVariants(variants, job, job.variants)
  const results: SharpJobResult[] = []
  for (const task of single) results.push(await runSingle(task, job))
  return results
}
