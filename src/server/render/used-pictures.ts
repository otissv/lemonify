import { planSteps } from '@/features/pipeline/pipeline'
import type { Pipeline } from '@/features/pipeline/pipeline'
import type { UsedItem } from '@/features/pipeline/layer-kinds'
import { workflowLayerPipeline } from '@/features/workflows/segments'
import type { UsedSnapshot } from '@/features/workflows/used-snapshot'
import type { WorkflowDefinition } from '@/features/workflows/workflow'

import type { DocumentDao } from '../dao/document-dao.ts'
import type { SourceDao } from '../dao/source-dao.ts'
import type { WorkflowDao } from '../dao/workflow-dao.ts'
import type { SourceStore } from '../tools/source-store.ts'
import type { PlanSource, UsedPicture } from './plan-pipeline.ts'

/** Where the items a layer uses are read from: the User's own as they are now, or a run's copy of them. */
export interface UsedSources {
  document(documentId: string): Promise<Pipeline | undefined>
  workflow(workflowId: string): Promise<WorkflowDefinition | undefined>
  image(sourceId: string): Promise<PlanSource | undefined>
}

/** The picture a document layer or workflow layer draws, or undefined when what it uses is gone. */
export async function usedPicture(
  item: UsedItem,
  sources: UsedSources,
): Promise<UsedPicture | undefined> {
  if (item.kind === 'document') {
    const pipeline = await sources.document(item.documentId)
    if (pipeline === undefined) return undefined
    return { canvas: pipeline.canvas, steps: planSteps(pipeline) }
  }
  const definition = await sources.workflow(item.workflowId)
  if (definition === undefined) return undefined
  let image: { id: string; width: number; height: number } | undefined
  if (item.sourceId !== undefined) {
    const source = await sources.image(item.sourceId)
    if (source === undefined) return undefined
    image = { id: item.sourceId, width: source.width, height: source.height }
  }
  const pipeline = workflowLayerPipeline(definition, image)
  return { canvas: pipeline.canvas, steps: planSteps(pipeline) }
}

/** Where the User's own items and images are read from as they are now. */
export type OwnedItems = {
  documents: DocumentDao
  workflows: WorkflowDao
  sources: SourceDao
  sourceStore: SourceStore
}

/** A stored image of the owner as planning needs it, or undefined when it is gone or someone else's. */
export function ownedImage(
  ownerId: string,
  items: Pick<OwnedItems, 'sources' | 'sourceStore'>,
): (sourceId: string) => Promise<PlanSource | undefined> {
  return async (sourceId) => {
    const source = await items.sources.findById(sourceId)
    if (source === null || source.ownerId !== ownerId) return undefined
    return {
      contentHash: source.contentHash,
      path: items.sourceStore.pathOf(source.contentHash),
      width: source.width,
      height: source.height,
    }
  }
}

/** The owner's documents, workflows and images as they are now; another User's are never found. */
export function ownedUsedSources(
  ownerId: string,
  items: OwnedItems,
): UsedSources {
  return {
    async document(documentId) {
      const found = await items.documents.findById(documentId)
      return found === null || found.ownerId !== ownerId
        ? undefined
        : found.pipeline
    },
    async workflow(workflowId) {
      const found = await items.workflows.findById(workflowId)
      return found === null || found.ownerId !== ownerId
        ? undefined
        : found.definition
    },
    image: ownedImage(ownerId, items),
  }
}

/** A run's copy of the items its layers use, with the owner's images. */
export function snapshotSources(
  snapshot: UsedSnapshot,
  image: UsedSources['image'],
): UsedSources {
  return {
    document: async (documentId) => snapshot.documents[documentId],
    workflow: async (workflowId) => snapshot.workflows[workflowId],
    image,
  }
}
