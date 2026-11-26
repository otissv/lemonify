import { planSteps } from '@/features/pipeline/pipeline'
import type { AiStep, Pipeline } from '@/features/pipeline/pipeline'

import { planPipeline } from '../render/plan-pipeline.ts'
import type { PlanLookups } from '../render/plan-pipeline.ts'

/** Draws the picture the next AI step acts on, or, last, the whole pipeline, where the Output settings apply. */
export type DrawSegment = { kind: 'draw' }
/** One AI step on one picture, named by the key its Result has; it runs on the GPU and can be batched with other images. */
export type AiSegment = { kind: 'ai'; step: AiStep; key: string }
export type RunSegment = DrawSegment | AiSegment

/** Every item of a run starts by drawing. */
export const FIRST_SEGMENT: DrawSegment = { kind: 'draw' }

const LOOPS = 'An AI step of this workflow waits on itself.'

/**
 * Splits what a run does to one input image into segments. Each AI step that
 * is on, at any depth (in groups, embedded document layers, and the documents
 * and workflows layers use), gets a draw segment of the picture it acts on and
 * a segment of its own, in the order the picture is made; the list ends with a
 * draw segment of the whole pipeline. The order comes from planning the
 * pipeline as if each AI step before had run, its work image at
 * `outputOf(index)` of its segment; a step that would act on the same picture
 * as one before it (the same workflow used twice on one image) is not run again.
 */
export async function runSegments(
  pipeline: Pipeline,
  lookups: Omit<PlanLookups, 'aiResultPath'>,
  outputOf: (index: number) => string,
): Promise<RunSegment[]> {
  const segments: RunSegment[] = []
  const done = new Map<string, string>()
  for (;;) {
    const plan = await planPipeline(pipeline.canvas, planSteps(pipeline), {
      ...lookups,
      aiResultPath: async (key) => done.get(key),
    })
    const next = plan.pending[0]
    if (next === undefined) break
    if (done.has(next.key)) throw new Error(LOOPS)
    segments.push(FIRST_SEGMENT)
    done.set(next.key, outputOf(segments.length))
    segments.push({ kind: 'ai', step: next.step, key: next.key })
  }
  segments.push(FIRST_SEGMENT)
  return segments
}

/** The work image each AI segment before `index` left, by the key of its Result. */
export function workImagesBefore(
  segments: ReadonlyArray<RunSegment>,
  index: number,
  outputOf: (index: number) => string,
): Map<string, string> {
  const done = new Map<string, string>()
  for (const [at, segment] of segments.entries()) {
    if (at >= index || segment.kind !== 'ai') continue
    done.set(segment.key, outputOf(at))
  }
  return done
}
