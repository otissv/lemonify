import { z } from 'zod'

import { startingAiContent } from '../../../src/features/ai/ai-defaults.ts'
import { PipelineStepKind } from '../../../src/features/pipeline/pipeline.ts'
import { startsAtPictureSize } from '../../../src/features/pipeline/sharp-starting-options.ts'
import { resetChangeFor } from '../../../src/features/pipeline/step-reset.ts'
import type { ResetStarting } from '../../../src/features/pipeline/step-reset.ts'
import { defineAppCommand } from '../app-command.ts'
import type { AppCommandContext } from '../app-command.ts'
import { withWorkers } from '../in-process-workers.ts'
import { PREVIEW_FLAGS, PREVIEW_HELP, PREVIEW_SHAPE } from '../preview-flag.ts'
import { pictureSizeBefore } from '../preview-document.ts'
import { change, requireStep } from './document-step.ts'

type ResetOptions = { documentId: string; stepId: string }

/** What the step starts from beyond the pipeline: the settings an AI tool's catalogue starts with, or the size of the picture a resize acts on. */
async function startingFor(
  context: AppCommandContext<ResetOptions>,
): Promise<ResetStarting> {
  const { app, actor, options } = context
  const current = await app.documents.get(actor, options.documentId)
  const step = requireStep(current, options.stepId)
  if (step.kind === PipelineStepKind.Ai) {
    return {
      ai: startingAiContent(step.tool, await app.aiTools.catalogue(step.tool)),
    }
  }
  if (step.kind !== PipelineStepKind.Sharp || !startsAtPictureSize(step.op)) {
    return {}
  }
  const size = await withWorkers(app, () =>
    pictureSizeBefore(app, actor, options.documentId, step.id),
  )
  return size === undefined ? {} : { size }
}

export const documentStepResetCommand = defineAppCommand({
  name: 'document step reset',
  summary: 'Put a step back as a new one of its kind starts',
  synopsis: '<documentId> <stepId> [--preview <path>]',
  help: `Puts one step back as the website starts a new step of its kind, as one
change that 'document undo' takes back. A Sharp step gets the options a new one
starts with (100% for scale, red for tint, the document's own image for a step
that needs another, the size of the picture it acts on for resize) and loses
its blend; an AI step gets the settings its tool's catalogue starts from; an
image layer, or an embedded document layer, gets the default placement and
keeps its image or steps; a group has nothing to reset. The step's name and whether it is on are kept. A
resize whose picture cannot be made yet, such as after an AI step with no
result, is left with no size.

Options:
${PREVIEW_HELP}`,
  shape: {
    documentId: z.string().min(1),
    stepId: z.string().min(1),
    ...PREVIEW_SHAPE,
  },
  positionals: ['documentId', 'stepId'],
  flags: { ...PREVIEW_FLAGS },
  async run(context) {
    const starting = await startingFor(context)
    return change(context, (current) =>
      resetChangeFor(requireStep(current, context.options.stepId), starting),
    )
  },
})
