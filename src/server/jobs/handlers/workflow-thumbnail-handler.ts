import { RunCanvasModeSchema } from '@/features/workflows/workflow'
import { shownForWorkflowNode } from '@/features/workflows/workflow-thumb-plan'

import type { WorkflowDao } from '../../dao/workflow-dao.ts'
import { RenderKind } from '../../tools/render-store.ts'
import { WrongJobKindError, runEach } from '../job-handler.ts'
import type { JobHandler, JobItem, JobReport } from '../job-handler.ts'
import { JobKind, JobState } from '../job-types.ts'
import type { WorkflowPlanner } from '../../render/workflow-planner.ts'
import { ensureRender } from './preview-handler.ts'
import type { RenderHandlerDependencies } from './preview-handler.ts'

export type WorkflowThumbnailHandlerDependencies = RenderHandlerDependencies & {
  workflows: WorkflowDao
  workflowPlanner: WorkflowPlanner
}

/**
 * Small pictures under each workflow diagram node, using the last input image.
 * AI steps are never run; thumbnails stop before them.
 */
export class WorkflowThumbnailHandler implements JobHandler {
  readonly #deps: WorkflowThumbnailHandlerDependencies

  constructor(deps: WorkflowThumbnailHandlerDependencies) {
    this.#deps = deps
  }

  run(items: ReadonlyArray<JobItem>): Promise<ReadonlyArray<JobReport>> {
    return runEach(
      items,
      async ({ job, context }) => {
        const { payload } = job
        if (payload.kind !== JobKind.WorkflowThumbnail) {
          throw new WrongJobKindError(job)
        }
        const { workflowPlanner } = this.#deps
        const workflow = await workflowPlanner.loadForJob(
          job.ownerId,
          payload.workflowId,
          payload.revision,
        )
        const filled = await workflowPlanner.filled(
          workflow,
          RunCanvasModeSchema.parse(payload.canvasMode),
        )
        const thumbnails: Array<{ stepId: string; key: string | null }> = []
        for (const [done, nodeId] of payload.nodeIds.entries()) {
          context.setProgress(done / payload.nodeIds.length)
          const shown = shownForWorkflowNode(
            filled.pipeline,
            nodeId,
            filled.firstSlotId,
          )
          if (shown === undefined) {
            thumbnails.push({ stepId: nodeId, key: null })
            continue
          }
          const plan = await workflowPlanner.plan(workflow, shown)
          if (plan.skipped.length > 0) {
            thumbnails.push({ stepId: nodeId, key: null })
            continue
          }
          const { key } = await ensureRender(
            this.#deps,
            RenderKind.WorkflowNode,
            plan,
          )
          thumbnails.push({ stepId: nodeId, key })
        }
        return {
          outcome: {
            state: JobState.Done,
            result: {
              kind: JobKind.WorkflowThumbnail,
              thumbnails,
            },
          },
        }
      },
      this.#deps.logger,
    )
  }
}
