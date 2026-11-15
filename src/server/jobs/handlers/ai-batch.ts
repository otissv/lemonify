import type { AiSettings, AiToolId } from '@/features/ai/ai-tools'

import type { AiToolRegistry } from '../../ai/ai-tool-registry.ts'
import type { JobItem } from '../job-handler.ts'

export type AiBatchEntry = {
  item: JobItem
  input: string
  output: string
}

/** A batch can only be stopped as a whole, so it stops once every Job in it has been cancelled. */
function cancelWhenAllAbort(
  entries: ReadonlyArray<AiBatchEntry>,
  cancel: () => void,
): void {
  let aborted = 0
  const onAbort = (): void => {
    aborted += 1
    if (aborted === entries.length) cancel()
  }
  for (const { item } of entries) {
    if (item.context.signal.aborted) onAbort()
    else item.context.signal.addEventListener('abort', onAbort, { once: true })
  }
}

/**
 * Runs Jobs that share a tool and settings as one batch on the tool's
 * engine, so the model loads once. Throws if the engine fails or the whole
 * batch is cancelled; on return every output file is written.
 */
export async function runAiBatch(
  registry: AiToolRegistry,
  tool: AiToolId,
  settings: AiSettings,
  entries: ReadonlyArray<AiBatchEntry>,
): Promise<void> {
  const running = registry.get(tool).engine.run(
    {
      tool,
      settings,
      requests: entries.map(({ item, input, output }) => ({
        id: item.job.id,
        input,
        output,
      })),
    },
    (fraction) => {
      for (const { item } of entries) item.context.setProgress(fraction)
    },
  )
  cancelWhenAllAbort(entries, running.cancel)
  await running.result
}
