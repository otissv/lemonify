import { z } from 'zod'

import { canvasSchema } from '../../../src/features/pipeline/canvas.ts'
import { defineAppCommand } from '../app-command.ts'
import { PREVIEW_FLAGS, PREVIEW_HELP, PREVIEW_SHAPE } from '../preview-flag.ts'
import { change } from './document-step.ts'

const dimension = z.coerce.number().int().positive()

export const documentCanvasCommand = defineAppCommand({
  name: 'document canvas',
  summary: 'Change a document’s canvas',
  synopsis:
    '<documentId> [--width <px>] [--height <px>] [--background <colour>] [--preview <path>]',
  help: `Changes the size or the background of the canvas the document's steps are drawn
on. What you leave out stays as it is. The steps are not changed, so layers keep
their settings and land where those settings put them on the new canvas. It can
be undone. Prints the document.

Options:
  --width <px>         Canvas width in pixels
  --height <px>        Canvas height in pixels
  --background <c>     A colour like #ff8000, or transparent
${PREVIEW_HELP}`,
  shape: {
    documentId: z.string().min(1),
    width: dimension.optional(),
    height: dimension.optional(),
    background: z.string().optional(),
    ...PREVIEW_SHAPE,
  },
  positionals: ['documentId'],
  flags: {
    width: { type: 'string' },
    height: { type: 'string' },
    background: { type: 'string' },
    ...PREVIEW_FLAGS,
  },
  run: (context) =>
    change(context, (current) => {
      const { width, height, background } = context.options
      return {
        type: 'set-canvas',
        canvas: canvasSchema.parse({
          width: width ?? current.pipeline.canvas.width,
          height: height ?? current.pipeline.canvas.height,
          background: background ?? current.pipeline.canvas.background,
        }),
      }
    }),
})
