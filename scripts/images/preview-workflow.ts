import { OUTPUT_NODE_ID } from '../../src/features/workflows/workflow-graph-layout.ts'
import type { RunCanvasMode } from '../../src/features/workflows/workflow.ts'
import { JobKind } from '../../src/server/jobs/job-types.ts'
import { RenderKind } from '../../src/server/tools/render-store.ts'
import type { App } from '../../src/server/composition.ts'
import type { Actor } from '../../src/server/domain/actor.ts'
import { ValidationError } from '../../src/server/errors.ts'
import type { Region } from './region.ts'
import { formatFor, writePicture } from './write-picture.ts'
import type { PictureFormat } from './write-picture.ts'

export type WorkflowPreviewOptions = {
  /** The diagram node to show; the output when not given. */
  nodeId?: string
  canvasMode: RunCanvasMode
  region?: Region
  width?: number
}

export type WorkflowPreviewPicture = {
  path: string
  bytes: number
  format: PictureFormat
  nodeId: string
  canvasMode: RunCanvasMode
  /** The picture's size in its own pixels, whatever size it was written at. */
  size: { width: number; height: number }
  region: Region | null
}

/**
 * Writes the large picture of a workflow diagram node, which the workflow page
 * shows beside the diagram, to `destination`. It is made by the same render the
 * page asks for. The caller must have Job workers running.
 */
export async function writeWorkflowPreview(
  app: App,
  actor: Actor,
  workflowId: string,
  destination: string,
  options: WorkflowPreviewOptions,
): Promise<WorkflowPreviewPicture> {
  formatFor(destination)
  const nodeId = options.nodeId ?? OUTPUT_NODE_ID
  const queued = await app.renders.requestWorkflowPreview(
    actor,
    workflowId,
    options.canvasMode,
    nodeId,
  )
  const done = await app.jobs.waitFor(actor, queued.id)
  if (done.result?.kind !== JobKind.WorkflowPreview) {
    throw new Error('The preview finished without a result.')
  }
  const { picture } = done.result
  if (picture === null) {
    throw new ValidationError(
      'This node has no picture: a step before it is not set up.',
    )
  }
  const opened = await app.renders.fetchWorkflow(
    actor,
    workflowId,
    RenderKind.Preview,
    picture.key,
  )
  const { name } = await app.workflows.get(actor, workflowId)
  const written = await writePicture(
    { stream: opened.stream, rendered: true },
    destination,
    name,
    { region: options.region, width: options.width },
  )
  return {
    ...written,
    nodeId,
    canvasMode: options.canvasMode,
    size: { width: picture.width, height: picture.height },
    region: options.region ?? null,
  }
}
