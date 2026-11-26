import type { PictureSize } from '@/features/pipeline/canvas'
import { MAX_DOCUMENT_NAME_LENGTH } from '@/features/documents/document'
import { isLayerStep, layerKind } from '@/features/pipeline/layer-kinds'
import type { UsedItem } from '@/features/pipeline/layer-kinds'
import { childSteps, findStep, placeAfter } from '@/features/pipeline/pipeline'
import type {
  EmbeddedDocumentStep,
  Pipeline,
  PipelineStep,
  Place,
} from '@/features/pipeline/pipeline'
import { MAX_STEP_NAME_LENGTH } from '@/features/pipeline/step-common'
import type { DocumentView } from '@/features/documents/document'
import {
  CreateFromError,
  convertedLayer,
  documentCanvas,
  embeddedFromDocument,
  documentFromWorkflow,
  drawnByLayer,
  embeddedFromWorkflow,
  shownInputImage,
  sourceName,
  workflowFromPipeline,
} from '@/features/workflows/create-from'
import type { ImageChoice } from '@/features/workflows/create-from'
import { MAX_WORKFLOW_NAME_LENGTH } from '@/features/workflows/workflow'
import { uniqueName } from '@/lib/unique-name'

import type { SourceDao } from '../dao/source-dao.ts'
import type { Actor } from '../domain/actor.ts'
import { requireOwned } from '../domain/ownership.ts'
import { ValidationError } from '../errors.ts'
import type { DocumentService } from './document-service.ts'
import type { ItemRef } from './used-items.ts'
import type { WorkflowService, WorkflowView } from './workflow-service.ts'

const MISSING_IMAGE = 'That image does not exist.'
const USES_WORKFLOW =
  'That layer uses a workflow: make a document from it instead.'
const USES_DOCUMENT =
  'That layer uses a document: make a workflow from it instead.'
const NOT_CONVERTIBLE =
  'Only a document layer or a workflow layer can be converted to an embedded document layer.'

/** A name as long as a step's may be. */
function stepName(name: string): string {
  return name.slice(0, MAX_STEP_NAME_LENGTH).trim()
}

export type CreateFromServiceDependencies = {
  documents: DocumentService
  workflows: WorkflowService
  sources: SourceDao
}

export type WorkflowFromDocumentOptions = {
  images: ImageChoice
  /** A group or embedded document layer to start from instead of the whole document. */
  stepId?: string
  /** The new workflow's name; the source's, made unique, when left out. */
  name?: string
}

export type InsertWorkflowOptions = {
  workflowId: string
  /** The image for the workflow's input slot; the slot stays empty without one. */
  sourceId?: string
  /** The step it goes after; at the end of the document when neither this nor `index` is given. */
  afterStepId?: string
  /** Where it goes in the list of `parentId`, or of the top level. */
  index?: number
  parentId?: string
}

export type DocumentFromWorkflowOptions = {
  /** A group or embedded document layer to start from instead of the whole workflow, or a workflow layer, which starts from the workflow it uses with the layer's image. */
  stepId?: string
  /** The image for the input slot (the actor's own), or null for none; the last input image added when left out. */
  inputImage?: string | null
  /** The canvas size, needed only when the workflow takes each input image's size and shows none. */
  size?: PictureSize
  /** The new document's name; the source's, made unique, when left out. */
  name?: string
}

/** Where an added workflow goes: after a step, at a place given, or at the end. */
function insertPlace(
  pipeline: Pipeline,
  step: PipelineStep,
  options: InsertWorkflowOptions,
): Place {
  const { afterStepId, index, parentId } = options
  if (afterStepId !== undefined) {
    if (index !== undefined || parentId !== undefined) {
      throw new ValidationError(
        'Give the step it goes after, or a place, not both.',
      )
    }
    return placeAfter(pipeline, step, afterStepId)
  }
  const at = index ?? childSteps(pipeline, parentId)?.length ?? 0
  return parentId === undefined ? { index: at } : { index: at, parentId }
}

/** What the layer `stepId` uses, when it is a document layer or a workflow layer. */
function usedBy(
  pipeline: Pipeline,
  stepId: string | undefined,
): UsedItem | undefined {
  if (stepId === undefined) return undefined
  const step = findStep(pipeline, stepId)?.step
  if (step === undefined || !isLayerStep(step)) return undefined
  return layerKind(step).uses(step)
}

function asValidation<T>(make: () => T): T {
  try {
    return make()
  } catch (error) {
    if (error instanceof CreateFromError) {
      throw new ValidationError(error.message, { cause: error })
    }
    throw error
  }
}

/**
 * Makes a new workflow from a document and a new document from a workflow,
 * through the same rules on the website and the command line. The source is
 * only read; the new item is a copy with an edit history of its own.
 */
export class CreateFromService {
  readonly #deps: CreateFromServiceDependencies

  constructor(deps: CreateFromServiceDependencies) {
    this.#deps = deps
  }

  async workflowFromDocument(
    actor: Actor,
    documentId: string,
    options: WorkflowFromDocumentOptions,
  ): Promise<WorkflowView> {
    const { documents, workflows } = this.#deps
    const document = await documents.get(actor, documentId)
    const used = usedBy(document.pipeline, options.stepId)
    if (used?.kind === 'workflow') throw new ValidationError(USES_WORKFLOW)
    if (used?.kind === 'document') {
      const { stepId: _layer, ...rest } = options
      return this.workflowFromDocument(actor, used.documentId, rest)
    }
    const definition = asValidation(() =>
      workflowFromPipeline(document.pipeline, {
        images: options.images,
        containerId: options.stepId,
      }),
    )
    const name =
      options.name ??
      uniqueName(
        sourceName(document.pipeline, options.stepId, document.name),
        await workflows.list(actor),
        MAX_WORKFLOW_NAME_LENGTH,
      )
    return workflows.create(actor, name, definition)
  }

  async documentFromWorkflow(
    actor: Actor,
    workflowId: string,
    options: DocumentFromWorkflowOptions,
  ): Promise<DocumentView> {
    const { workflows } = this.#deps
    const found = await workflows.get(actor, workflowId)
    const used = usedBy(found.pipeline, options.stepId)
    if (used?.kind === 'document') throw new ValidationError(USES_DOCUMENT)
    if (used?.kind === 'workflow') {
      const { stepId: _layer, ...rest } = options
      const inner = await workflows.get(actor, used.workflowId)
      return this.#documentFrom(
        actor,
        {
          ...inner,
          ...drawnByLayer(inner, used.sourceId),
        },
        rest,
      )
    }
    const { inputImage } = options
    return this.#documentFrom(
      actor,
      inputImage === undefined
        ? found
        : { ...found, ...drawnByLayer(found, inputImage ?? undefined) },
      options,
    )
  }

  async #documentFrom(
    actor: Actor,
    workflow: WorkflowView,
    options: DocumentFromWorkflowOptions,
  ): Promise<DocumentView> {
    const { documents } = this.#deps
    const shownSize = await this.#shownSize(actor, workflow)
    const pipeline = asValidation(() =>
      documentFromWorkflow(workflow, {
        canvas: documentCanvas(workflow, shownSize, options.size),
        containerId: options.stepId,
      }),
    )
    const name =
      options.name ??
      uniqueName(
        sourceName(workflow.pipeline, options.stepId, workflow.name),
        await documents.list(actor),
        MAX_DOCUMENT_NAME_LENGTH,
      )
    return documents.createFromPipeline(actor, name, pipeline)
  }

  /**
   * Adds a workflow to a document as an embedded document layer named after
   * it: a copy with the chosen image in its input slot, as one undoable change.
   */
  async insertWorkflow(
    actor: Actor,
    documentId: string,
    revision: number,
    options: InsertWorkflowOptions,
  ): Promise<DocumentView> {
    const { documents } = this.#deps
    const [document, step] = await Promise.all([
      documents.get(actor, documentId),
      this.workflowAsEmbedded(actor, options.workflowId, options.sourceId),
    ])
    return documents.change(actor, documentId, revision, {
      type: 'add-step',
      step,
      ...insertPlace(document.pipeline, step, options),
    })
  }

  /** A workflow as the embedded document layer it becomes in a document: named after it, a copy, with `sourceId` (the actor's own) in its input slot. */
  async workflowAsEmbedded(
    actor: Actor,
    workflowId: string,
    sourceId: string | undefined,
  ): Promise<EmbeddedDocumentStep> {
    const workflow = await this.#deps.workflows.get(actor, workflowId)
    if (sourceId !== undefined) {
      requireOwned(
        actor,
        await this.#deps.sources.findById(sourceId),
        MISSING_IMAGE,
      )
    }
    return embeddedFromWorkflow(workflow, stepName(workflow.name), sourceId)
  }

  /**
   * The embedded document layer that the document layer or workflow layer
   * `stepId` of `holder` becomes when converted: a copy of what it uses, as
   * that is now, in the layer's place. The `convert-step` change puts it there,
   * so it can be undone like any other edit.
   */
  async layerAsEmbedded(
    actor: Actor,
    holder: ItemRef,
    stepId: string,
  ): Promise<EmbeddedDocumentStep> {
    const { documents, workflows } = this.#deps
    const pipeline =
      holder.kind === 'document'
        ? (await documents.get(actor, holder.id)).pipeline
        : (await workflows.get(actor, holder.id)).pipeline
    const step = findStep(pipeline, stepId)?.step
    const used =
      step !== undefined && isLayerStep(step)
        ? layerKind(step).uses(step)
        : undefined
    if (step === undefined || !isLayerStep(step) || used === undefined) {
      throw new ValidationError(NOT_CONVERTIBLE)
    }
    if (used.kind === 'document') {
      const document = await documents.get(actor, used.documentId)
      return convertedLayer(
        step,
        embeddedFromDocument(document.pipeline, stepName(document.name)),
      )
    }
    return convertedLayer(
      step,
      await this.workflowAsEmbedded(actor, used.workflowId, used.sourceId),
    )
  }

  /** The size of the image the workflow shows in its input slot, which must be the actor's own. */
  async #shownSize(
    actor: Actor,
    workflow: WorkflowView,
  ): Promise<PictureSize | undefined> {
    const sourceId = shownInputImage(workflow)
    if (sourceId === undefined) return undefined
    const source = requireOwned(
      actor,
      await this.#deps.sources.findById(sourceId),
      MISSING_IMAGE,
    )
    return { width: source.width, height: source.height }
  }
}
