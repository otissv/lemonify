import { access } from 'node:fs/promises'

import { ImageOptionsError } from './errors.ts'

/** What a planned write produces: a plain output, one width variant, a rewritten source, or a manifest. */
export type PlannedWriteKind = 'file' | 'variant' | 'inPlace' | 'manifest'

export interface PlannedWrite {
  file: string
  /** The file or files it is made from; null for a generated image or a manifest. */
  source: string | string[] | null
  kind: PlannedWriteKind
  /** True when the file is already there and would be replaced. */
  exists: boolean
}

/** The result of a dry run: every file a job would read and write. Nothing is written. */
export interface WritePlan<TWrite extends PlannedWrite = PlannedWrite> {
  dryRun: true
  reads: string[]
  writes: TWrite[]
}

export async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

/** Real runners call this so a job marked as a dry run can never write. */
export function refuseDryRun(dryRun: boolean, planner: string): void {
  if (dryRun)
    throw new ImageOptionsError([
      `dryRun: this runner writes files; use ${planner} for a dry run`,
    ])
}
