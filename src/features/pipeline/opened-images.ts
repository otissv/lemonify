import type { SourceSummary } from '@/features/documents/document'
import { PipelineStepKind } from '@/features/pipeline/pipeline'
import type { Pipeline } from '@/features/pipeline/pipeline'

/**
 * The images a step can use as a second image: the ones opened by the Open
 * image steps before it, in order, each once. Images the document does not
 * know about yet are left out.
 */
export function imagesOpenedBefore(
  pipeline: Pipeline,
  stepId: string,
  sources: ReadonlyArray<SourceSummary>,
): SourceSummary[] {
  const opened: SourceSummary[] = []
  for (const step of pipeline.steps) {
    if (step.id === stepId) break
    if (step.kind !== PipelineStepKind.Source) continue
    const source = sources.find(({ id }) => id === step.sourceId)
    if (source !== undefined && !opened.includes(source)) opened.push(source)
  }
  return opened
}
