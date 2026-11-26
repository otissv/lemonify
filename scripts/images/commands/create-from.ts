import { z } from 'zod'

import { ImageChoiceSchema } from '../../../src/features/workflows/create-from.ts'
import type { PictureSize } from '../../../src/features/pipeline/canvas.ts'
import type { DocumentView } from '../../../src/features/documents/document.ts'
import type { App } from '../../../src/server/composition.ts'
import type { Actor } from '../../../src/server/domain/actor.ts'
import { ValidationError } from '../../../src/server/errors.ts'
import type { WorkflowView } from '../../../src/server/services/workflow-service.ts'

const id = z.string().min(1)

/** The flags `workflow create` takes to make a workflow from a document. */
export const FROM_DOCUMENT_SHAPE = {
  fromDocument: id.optional(),
  group: id.optional(),
  images: ImageChoiceSchema.optional(),
}

export const FROM_DOCUMENT_FLAGS = {
  'from-document': { type: 'string' },
  group: { type: 'string' },
  images: { type: 'string' },
} as const

export const FROM_DOCUMENT_HELP = `  --from-document <id> Make the workflow from this document (its name, made unique, unless you give one)
  --group <stepId>     Start from this group or embedded document layer of it, or from the
                       document a document layer of it uses
  --images <choice>    What to do with its images: keep, remove (every one becomes an input)
                       or remove-input (only the first image layer's)`

type FromDocumentOptions = {
  name?: string
  fromDocument?: string
  group?: string
  images?: z.output<typeof ImageChoiceSchema>
}

/** Makes a workflow from a document as `workflow create --from-document` asks; `others` says whether flags that build a workflow were given too. */
export async function workflowFromDocumentCommand(
  app: App,
  actor: Actor,
  options: FromDocumentOptions,
  others: boolean,
): Promise<WorkflowView> {
  const { fromDocument, group, images, name } = options
  if (fromDocument === undefined) {
    throw new ValidationError('Give --group and --images with --from-document.')
  }
  if (others) {
    throw new ValidationError(
      'A workflow made with --from-document takes its pipeline and canvas from the document. Change it with workflow update afterwards.',
    )
  }
  if (images === undefined) {
    throw new ValidationError(
      'Give --images keep, remove or remove-input with --from-document.',
    )
  }
  return app.createFrom.workflowFromDocument(actor, fromDocument, {
    images,
    stepId: group,
    name,
  })
}

/** The flags `document create` takes to make a document from a workflow. */
export const FROM_WORKFLOW_SHAPE = {
  fromWorkflow: id.optional(),
  group: id.optional(),
}

export const FROM_WORKFLOW_FLAGS = {
  'from-workflow': { type: 'string' },
  group: { type: 'string' },
} as const

export const FROM_WORKFLOW_HELP = `  --from-workflow <id> Make the document from this workflow: the <sourceId> given, or else its
                       input image (the last one added), goes in its first image layer
                       (name: the workflow's, made unique)
  --group <stepId>     Start from this group or embedded document layer of it, or from the
                       workflow a workflow layer of it uses, with the layer's image`

type FromWorkflowOptions = {
  sourceId?: string
  name?: string
  fromWorkflow?: string
  group?: string
  width?: number
  height?: number
  background?: string
}

function givenSize(options: FromWorkflowOptions): PictureSize | undefined {
  const { width, height } = options
  if (width === undefined && height === undefined) return undefined
  if (width === undefined || height === undefined) {
    throw new ValidationError('Give both --width and --height.')
  }
  return { width, height }
}

/** Makes a document from a workflow as `document create --from-workflow` asks. */
export async function documentFromWorkflowCommand(
  app: App,
  actor: Actor,
  options: FromWorkflowOptions,
): Promise<DocumentView> {
  const { fromWorkflow, sourceId, background, group, name } = options
  if (fromWorkflow === undefined) {
    throw new ValidationError('Give --group with --from-workflow.')
  }
  if (background !== undefined) {
    throw new ValidationError(
      'A document made with --from-workflow takes its background from the workflow. Leave out --background.',
    )
  }
  return app.createFrom.documentFromWorkflow(actor, fromWorkflow, {
    stepId: group,
    ...(sourceId === undefined ? {} : { inputImage: sourceId }),
    size: givenSize(options),
    name,
  })
}

type AddWorkflowOptions = {
  documentId: string
  workflow: string
  source?: string
  index?: number
  into?: string
}

/** Adds a workflow to a document as `document step add --workflow` asks: an embedded document layer, at --index or at the end, inside --into when given. */
export async function addWorkflowCommand(
  app: App,
  actor: Actor,
  options: AddWorkflowOptions,
): Promise<DocumentView> {
  const current = await app.documents.get(actor, options.documentId)
  return app.createFrom.insertWorkflow(
    actor,
    options.documentId,
    current.revision,
    {
      workflowId: options.workflow,
      sourceId: options.source,
      index: options.index,
      parentId: options.into,
    },
  )
}
