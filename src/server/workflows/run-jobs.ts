import path from 'node:path'

import { WorkerPool } from '@/features/ai/ai-tools'

import type { AiToolRegistry } from '../ai/ai-tool-registry.ts'
import { JobKind } from '../jobs/job-types.ts'
import type { NewJob } from '../services/job-service.ts'
import type { RunSegment } from './run-segments.ts'

export type SegmentJobArguments = {
  runId: string
  /** The segment the Job runs, and where it is in the run's segments. */
  segment: RunSegment
  index: number
  sourceId: string
  /** The work image the previous segment left; absent on the first segment. */
  input?: string
  registry: AiToolRegistry
}

/** The Job that runs one segment of a workflow run on one Source. AI segments say which tool and batch they belong to. */
export function segmentJobSpec({
  runId,
  segment,
  index,
  sourceId,
  input,
  registry,
}: SegmentJobArguments): NewJob {
  const base = {
    kind: JobKind.RunItem,
    groupKey: runId,
    workflowRunId: runId,
  } as const
  if (segment.kind === 'draw') {
    return {
      ...base,
      pool: WorkerPool.Cpu,
      payload: {
        kind: JobKind.RunItem,
        workflowRunId: runId,
        sourceId,
        segment: index,
        input,
      },
    }
  }
  const entry = registry.get(segment.step.tool)
  return {
    ...base,
    pool: entry.summary.pool,
    payload: {
      kind: JobKind.RunItem,
      workflowRunId: runId,
      sourceId,
      segment: index,
      input,
      tool: segment.step.tool,
      batchKey: entry.batchKey(segment.step.settings),
    },
  }
}

/** The folder a run keeps its work images in; removed when the run ends. */
export function runWorkDirectory(workRoot: string, runId: string): string {
  return path.join(workRoot, `run-${runId}`)
}
