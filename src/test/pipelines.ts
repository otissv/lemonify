import { canvasOfSize } from '@/features/pipeline/canvas'
import { createPipeline } from '@/features/pipeline/pipeline'
import type { Pipeline, PipelineStep } from '@/features/pipeline/pipeline'

/** The size of the pictures tests make: small, and the same as the fixture images. */
export const TEST_CANVAS = canvasOfSize(10, 10)

/** A pipeline on the test canvas with these steps. */
export function pipelineOf(...steps: ReadonlyArray<PipelineStep>): Pipeline {
  return createPipeline(TEST_CANVAS, steps)
}
