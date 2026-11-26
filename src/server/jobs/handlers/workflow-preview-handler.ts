import { shownForWorkflowNode } from '@/features/workflows/workflow-thumb-plan'

import { RenderKind } from '../../tools/render-store.ts'
import { WrongJobKindError, runEach } from '../job-handler.ts'
import type { JobHandler, JobItem, JobReport } from '../job-handler.ts'
import { JobKind, JobState } from '../job-types.ts'
import { ensureRender } from './preview-handler.ts'
import type { WorkflowThumbnailHandlerDependencies } from './workflow-thumbnail-handler.ts'

/**
 * The large picture of one workflow diagram node, at the size a document's
 * preview is shown, made from the same steps as the node's thumbnail: the last
 * input image drawn in, and AI steps left out. A node whose steps cannot make a
 * picture has none.
 */
export class WorkflowPreviewHandler implements JobHandler {
  readonly #deps: WorkflowThumbnailHandlerDependencies

  constructor(deps: WorkflowThumbnailHandlerDependencies) {
    this.#deps = deps
  }

  run(items: ReadonlyArray<JobItem>): Promise<ReadonlyArray<JobReport>> {
    return runEach(
      items,
      async ({ job }) => {
        const { payload } = job
        if (payload.kind !== JobKind.WorkflowPreview) {
          throw new WrongJobKindError(job)
        }
        const { workflowPlanner } = this.#deps
        const workflow = await workflowPlanner.loadForJob(
          job.ownerId,
          payload.workflowId,
          payload.revision,
        )
        const filled = await workflowPlanner.filled(workflow)
        const shown = shownForWorkflowNode(
          filled.pipeline,
          payload.nodeId,
          filled.slotId,
        )
        const plan =
          shown === undefined
            ? undefined
            : await workflowPlanner.plan(workflow, shown)
        const picture =
          plan === undefined || plan.skipped.length > 0
            ? null
            : await ensureRender(this.#deps, RenderKind.Preview, plan)
        return {
          outcome: {
            state: JobState.Done,
            result: {
              kind: JobKind.WorkflowPreview,
              nodeId: payload.nodeId,
              picture:
                picture === null ? null : { key: picture.key, ...picture.size },
            },
          },
        }
      },
      this.#deps.logger,
    )
  }
}
