import { JobKind } from '../../src/server/jobs/job-types.ts'
import type { App } from '../../src/server/composition.ts'
import type { Actor } from '../../src/server/domain/actor.ts'

export type AiStepsRun = {
  /** The steps that were run, in order. */
  ran: string[]
}

async function pendingSteps(
  app: App,
  actor: Actor,
  documentId: string,
): Promise<string[]> {
  const queued = await app.renders.requestPreview(actor, documentId)
  const done = await app.jobs.waitFor(actor, queued.id)
  if (done.result?.kind !== JobKind.Preview) {
    throw new Error('The preview finished without a result.')
  }
  return done.result.pendingStepIds
}

async function runStep(
  app: App,
  actor: Actor,
  documentId: string,
  stepId: string,
): Promise<void> {
  const queued = await app.renders.requestAiStep(actor, documentId, stepId)
  await app.jobs.waitFor(actor, queued.id)
}

/**
 * Runs AI steps the way the website's Run button does: one at a time, each on
 * the picture the steps before it made, so the earlier ones must have results
 * first. With a step id only that step is run, and the service refuses it if
 * an earlier one is still waiting or it has a result already. Without one,
 * every step that is waiting is run in order. The caller must have Job workers
 * running.
 */
export async function runAiSteps(
  app: App,
  actor: Actor,
  documentId: string,
  stepId?: string,
): Promise<AiStepsRun> {
  if (stepId !== undefined) {
    await runStep(app, actor, documentId, stepId)
    return { ran: [stepId] }
  }
  const ran: string[] = []
  for (;;) {
    const [next] = await pendingSteps(app, actor, documentId)
    if (next === undefined) return { ran }
    await runStep(app, actor, documentId, next)
    ran.push(next)
  }
}
