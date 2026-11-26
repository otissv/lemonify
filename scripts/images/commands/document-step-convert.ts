import { z } from 'zod'

import { defineAppCommand } from '../app-command.ts'
import { PREVIEW_FLAGS, PREVIEW_HELP, PREVIEW_SHAPE } from '../preview-flag.ts'
import { change } from './document-step.ts'

/** What a layer can be converted to. */
const CONVERT_TARGETS = ['embedded-document'] as const

export const documentStepConvertCommand = defineAppCommand({
  name: 'document step convert',
  summary:
    'Turn a document layer or workflow layer into an embedded document layer',
  synopsis: '<documentId> <stepId> --to embedded-document [--preview <path>]',
  help: `Puts an embedded document layer in the place of a document layer or a
workflow layer: it holds a copy of the steps of the document or workflow the
layer uses, as they are now (a workflow layer's image goes in the copy's input
slot), so this one place can change on its own. The layer's name, whether it
is on and where it is placed are kept. An embedded document layer draws on a
blank canvas the size of the one it is placed on, where a document layer drew
at its document's own size. It is one change, which 'document undo' takes back.

Options:
  --to embedded-document  What the layer becomes
${PREVIEW_HELP}`,
  shape: {
    documentId: z.string().min(1),
    stepId: z.string().min(1),
    to: z.enum(CONVERT_TARGETS),
    ...PREVIEW_SHAPE,
  },
  positionals: ['documentId', 'stepId'],
  flags: { ...PREVIEW_FLAGS, to: { type: 'string' } },
  async run(context) {
    const { app, actor, options } = context
    const step = await app.createFrom.layerAsEmbedded(
      actor,
      { kind: 'document', id: options.documentId },
      options.stepId,
    )
    return change(context, () => ({ type: 'convert-step', step }))
  },
})
