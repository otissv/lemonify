import { rm } from 'node:fs/promises'

import {
  InvalidChangeError,
  MAX_HISTORY_ENTRIES,
} from '@/features/pipeline/document-change'
import { leafSteps } from '@/features/pipeline/pipeline'
import { pipelineOperandSourceIds } from '@/features/pipeline/image-operands'
import {
  pipelineStepLabel,
  stepProblem,
} from '@/features/pipeline/step-problems'
import { planSegments, workflowProblem } from '@/features/workflows/segments'
import {
  WorkflowDefinitionSchema,
  WorkflowNameSchema,
  createWorkflow,
} from '@/features/workflows/workflow'
import type { WorkflowDefinition } from '@/features/workflows/workflow'
import {
  applyWorkflowChange,
  planWorkflowChange,
} from '@/features/workflows/workflow-change'
import type { WorkflowChange } from '@/features/workflows/workflow-change'

import type { AiToolRegistry } from '../ai/ai-tool-registry.ts'
import type { JobDao } from '../dao/job-dao.ts'
import type { SourceDao } from '../dao/source-dao.ts'
import { RunState, STALE_WORKFLOW_MESSAGE } from '../dao/workflow-dao.ts'
import type {
  WorkflowDao,
  WorkflowRecord,
  WorkflowRunRecord,
} from '../dao/workflow-dao.ts'
import type { Actor } from '../domain/actor.ts'
import { isoNow } from '../domain/clock.ts'
import type { Clock, IdGenerator } from '../domain/clock.ts'
import { requireOwned } from '../domain/ownership.ts'
import { ConflictError, ValidationError } from '../errors.ts'
import { JobKind, JobState, isTerminal } from '../jobs/job-types.ts'
import type { JobRecord } from '../jobs/job-types.ts'
import {
  openRunArchive,
  runArchiveName,
  writeRunArchive,
} from '../workflows/run-archive.ts'
import type {
  OpenedRunArchive,
  WrittenRunArchive,
} from '../workflows/run-archive.ts'
import { runItems } from '../workflows/run-items.ts'
import type { RunItem } from '../workflows/run-items.ts'
import { runWorkDirectory, segmentJobSpec } from '../workflows/run-jobs.ts'
import type { SourceSummary } from '@/features/documents/document'
import type { ChangePublisher } from '../realtime/change-publisher.ts'
import type { JobService } from './job-service.ts'
import type { ResultService } from './result-service.ts'
import { toSourceSummary } from './source-service.ts'

const MISSING_WORKFLOW = 'That workflow does not exist.'
const MISSING_RUN = 'That run does not exist.'
const DUPLICATE_NAME = 'A workflow with this name already exists.'
const MISSING_SOURCE = 'An image in this workflow no longer exists.'
const NOTHING_CHOSEN = 'Choose at least one image to run the workflow on.'
const CHOSEN_TWICE = 'Each image can be chosen once.'
const NOT_AN_INPUT = 'Choose images from the workflow’s input images.'
const NOTHING_TO_UNDO = 'There is nothing to undo.'
const NOTHING_TO_REDO = 'There is nothing to redo.'
const CANCEL_PASSES = 3

export type WorkflowView = WorkflowDefinition & {
  id: string
  name: string
  revision: number
  canUndo: boolean
  canRedo: boolean
  createdAt: string
  updatedAt: string
}

/** How many of a run's Jobs are in each state, and how far along it is. */
export type RunJobCounts = {
  total: number
  waiting: number
  running: number
  done: number
  failed: number
  cancelled: number
}

export type RunView = {
  id: string
  workflowId: string | null
  /** The input images the run was started on, in the workflow's order. */
  sourceIds: string[]
  state: RunState
  createdAt: string
  finishedAt: string | null
  jobs: RunJobCounts
  /** 0 to 1 across every Job of the run, so far. */
  progress: number
  /** The plain-words reasons Jobs of the run failed, without repeats. */
  errors: string[]
  /** Each image of the run, in the order of `sourceIds`, with where it has got to. */
  items: RunItem[]
}

/** The images a run made from one Source, in the order of the Output's widths. */
export type RunOutput = {
  source: SourceSummary
  images: Array<{
    resultId: string
    fileName: string
    /** The width asked for, or null when the Output keeps the size. */
    width: number | null
  }>
}

export type WorkflowServiceDependencies = {
  workflows: WorkflowDao
  sources: SourceDao
  jobs: JobService
  jobDao: JobDao
  registry: AiToolRegistry
  clock: Clock
  ids: IdGenerator
  workRoot: string
  results: ResultService
  /** Tells the person's open tabs what changed. */
  changes: ChangePublisher
}

function asValidation(error: unknown): unknown {
  return error instanceof InvalidChangeError
    ? new ValidationError(error.message, { cause: error })
    : error
}

function normalise(name: string): string {
  return name.trim().toLocaleLowerCase()
}

function cleanName(raw: string): string {
  const parsed = WorkflowNameSchema.safeParse(raw)
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? 'Enter a name.',
    )
  }
  return parsed.data
}

/** The workflow with only the chosen input images, kept in its own order; the workflow as it is when none are chosen. */
function chosenInputs(
  definition: WorkflowDefinition,
  sourceIds: ReadonlyArray<string> | undefined,
): WorkflowDefinition {
  if (sourceIds === undefined) return definition
  if (sourceIds.length === 0) throw new ValidationError(NOTHING_CHOSEN)
  const chosen = new Set(sourceIds)
  if (chosen.size !== sourceIds.length) throw new ValidationError(CHOSEN_TWICE)
  const inputs = definition.inputs.filter((id) => chosen.has(id))
  if (inputs.length !== chosen.size) throw new ValidationError(NOT_AN_INPUT)
  return { ...definition, inputs }
}

/** The Sources in the order the workflow lists them, so a run's outputs come back in that order whatever order its Jobs finished in. */
function inputOrder(definition: WorkflowDefinition): string[] {
  return [...definition.inputs]
}

function countJobs(jobs: ReadonlyArray<JobRecord>): RunJobCounts {
  const counts: RunJobCounts = {
    total: jobs.length,
    waiting: 0,
    running: 0,
    done: 0,
    failed: 0,
    cancelled: 0,
  }
  for (const job of jobs) counts[job.state] += 1
  return counts
}

/** A run is over when every Job is; it is failed if any Job failed, cancelled if any was cancelled, otherwise done. */
export function deriveRunState(jobs: ReadonlyArray<JobRecord>): RunState {
  if (jobs.some((job) => !isTerminal(job.state))) return RunState.Running
  if (jobs.some((job) => job.state === JobState.Failed)) return RunState.Failed
  if (jobs.some((job) => job.state === JobState.Cancelled)) {
    return RunState.Cancelled
  }
  return RunState.Done
}

/**
 * Workflows and their runs. A run is one Job per Source per segment; the
 * state of a run is worked out from its Jobs, so it can never disagree with them.
 */
export class WorkflowService {
  readonly #deps: WorkflowServiceDependencies

  constructor(deps: WorkflowServiceDependencies) {
    this.#deps = deps
  }

  async create(
    actor: Actor,
    name: string,
    definition?: WorkflowDefinition,
  ): Promise<WorkflowView> {
    const { workflows, clock, ids } = this.#deps
    const cleaned = cleanName(name)
    await this.#requireFreeName(actor, cleaned)
    const chosen = this.#parseDefinition(
      definition ?? this.#emptyDefinition(cleaned),
    )
    await this.#checkDefinition(actor, chosen)
    const now = isoNow(clock)
    const record: WorkflowRecord = {
      id: ids.next(),
      ownerId: actor.userId,
      name: cleaned,
      definition: chosen,
      revision: 0,
      historyCursor: 0,
      createdAt: now,
      updatedAt: now,
    }
    await workflows.insert(record)
    this.#announce(actor.userId)
    return this.#workflowView(record)
  }

  async list(actor: Actor): Promise<WorkflowView[]> {
    const records = await this.#deps.workflows.listByOwner(actor.userId)
    const views: WorkflowView[] = []
    for (const record of records) views.push(await this.#workflowView(record))
    return views
  }

  async get(actor: Actor, id: string): Promise<WorkflowView> {
    return this.#workflowView(await this.#owned(actor, id))
  }

  async rename(actor: Actor, id: string, name: string): Promise<WorkflowView> {
    await this.#owned(actor, id)
    const cleaned = cleanName(name)
    await this.#requireFreeName(actor, cleaned, id)
    const renamed = await this.#deps.workflows.rename(
      id,
      cleaned,
      isoNow(this.#deps.clock),
    )
    this.#announceUpdated(actor.userId, renamed)
    this.#announce(actor.userId)
    return this.#workflowView(renamed)
  }

  /** Applies one edit as one Edit history entry; `revision` is the one the caller last saw. */
  async change(
    actor: Actor,
    id: string,
    revision: number,
    change: WorkflowChange,
  ): Promise<WorkflowView> {
    const record = await this.#current(actor, id, revision)
    const planned = this.#plan(record.definition, change)
    if (planned === null) return this.#workflowView(record)
    await this.#checkDefinition(actor, planned.definition)
    const changed = await this.#deps.workflows.applyChange({
      id,
      expectedRevision: revision,
      definition: planned.definition,
      patch: planned.patch,
      maxEntries: MAX_HISTORY_ENTRIES,
      now: isoNow(this.#deps.clock),
    })
    this.#announceUpdated(actor.userId, changed)
    return this.#workflowView(changed)
  }

  undo(actor: Actor, id: string, revision: number): Promise<WorkflowView> {
    return this.#step(actor, id, revision, -1)
  }

  redo(actor: Actor, id: string, revision: number): Promise<WorkflowView> {
    return this.#step(actor, id, revision, 0)
  }

  /** Undo applies the inverse of the entry below the cursor; redo applies the forward change of the entry at the cursor. */
  async #step(
    actor: Actor,
    id: string,
    revision: number,
    offset: -1 | 0,
  ): Promise<WorkflowView> {
    const { workflows, clock } = this.#deps
    const record = await this.#current(actor, id, revision)
    const entry = await workflows.findEntry(id, record.historyCursor + offset)
    if (entry === null) {
      throw new ValidationError(
        offset === -1 ? NOTHING_TO_UNDO : NOTHING_TO_REDO,
      )
    }
    const change = offset === -1 ? entry.patch.inverse : entry.patch.forward
    let definition: WorkflowDefinition
    try {
      definition = applyWorkflowChange(record.definition, change)
    } catch (error) {
      throw asValidation(error)
    }
    await this.#checkDefinition(actor, definition)
    const moved = await workflows.moveCursor({
      id,
      expectedRevision: revision,
      definition,
      cursor:
        offset === -1 ? record.historyCursor - 1 : record.historyCursor + 1,
      now: isoNow(clock),
    })
    this.#announceUpdated(actor.userId, moved)
    return this.#workflowView(moved)
  }

  async delete(actor: Actor, id: string): Promise<void> {
    await this.#owned(actor, id)
    await this.#deps.workflows.delete(id)
    this.#deps.changes.publish(actor.userId, {
      type: 'workflow.deleted',
      workflowId: id,
    })
    this.#announce(actor.userId)
  }

  /**
   * Starts a run: one Job per input image for the first segment, each drawn on
   * the canvas the workflow's canvas size gives it. `sourceIds` chooses some
   * of the workflow's input images; without it the run takes them all.
   * Everything that can be checked is checked first, so a run never starts
   * half-valid.
   */
  async run(
    actor: Actor,
    id: string,
    options: { sourceIds?: ReadonlyArray<string> } = {},
  ): Promise<RunView> {
    const workflow = await this.#owned(actor, id)
    const definition = chosenInputs(workflow.definition, options.sourceIds)
    const problem = workflowProblem(definition)
    if (problem !== undefined) throw new ValidationError(problem)
    await this.#checkDefinition(actor, definition)
    this.#requireSetUp(definition)
    const { workflows, jobs, registry, clock, ids } = this.#deps
    const run: WorkflowRunRecord = {
      id: ids.next(),
      workflowId: workflow.id,
      ownerId: actor.userId,
      definition,
      state: RunState.Running,
      createdAt: isoNow(clock),
      finishedAt: null,
    }
    await workflows.insertRun(run)
    const segments = planSegments(definition.pipeline)
    try {
      await jobs.enqueue(
        actor,
        definition.inputs.map((sourceId) =>
          segmentJobSpec({
            runId: run.id,
            segments,
            index: 0,
            sourceId,
            registry,
          }),
        ),
      )
    } catch (error) {
      await workflows.deleteRun(run.id)
      throw error
    }
    this.#announce(actor.userId)
    return this.#view(run)
  }

  async getRun(actor: Actor, runId: string): Promise<RunView> {
    return this.#view(await this.#ownedRun(actor, runId))
  }

  async listRuns(actor: Actor, workflowId?: string): Promise<RunView[]> {
    const runs = await this.#deps.workflows.listRuns(actor.userId, workflowId)
    const views: RunView[] = []
    for (const run of runs) views.push(await this.#view(run))
    return views
  }

  /** Stops a run: waiting Jobs are dropped and running ones asked to stop. A stopping Job queues no next segment. */
  async cancelRun(actor: Actor, runId: string): Promise<RunView> {
    const run = await this.#ownedRun(actor, runId)
    const { jobDao, clock } = this.#deps
    for (let pass = 0; pass < CANCEL_PASSES; pass += 1) {
      const active = await jobDao.listActive({ workflowRunId: run.id })
      if (active.length === 0) break
      for (const job of active)
        await jobDao.requestCancel(job.id, isoNow(clock))
    }
    this.#announce(actor.userId)
    return this.#view(run)
  }

  /** Deletes a finished run and, with it, the Results it made. */
  async deleteRun(actor: Actor, runId: string): Promise<void> {
    const run = await this.#ownedRun(actor, runId)
    const view = await this.#view(run)
    if (view.state === RunState.Running) {
      throw new ConflictError('Cancel the run before deleting it.')
    }
    await this.#deps.workflows.deleteRun(run.id)
    this.#announce(actor.userId)
  }

  /** What a run made, grouped by the Source each image came from; only finished items appear. */
  async runOutputs(actor: Actor, runId: string): Promise<RunOutput[]> {
    const run = await this.#ownedRun(actor, runId)
    const { jobDao, sources, results } = this.#deps
    const widths = [...run.definition.output.widths]
    const finished = await jobDao.list(run.ownerId, {
      workflowRunId: run.id,
      state: [JobState.Done],
    })
    const outputs: RunOutput[] = []
    for (const job of finished) {
      if (job.result?.kind !== JobKind.RunItem) continue
      if (job.payload.kind !== JobKind.RunItem) continue
      if (job.result.resultIds.length === 0) continue
      const source = await sources.findById(job.payload.sourceId)
      if (source === null) continue
      const images: RunOutput['images'] = []
      for (const [index, resultId] of job.result.resultIds.entries()) {
        const result = await results.get(actor, resultId)
        images.push({
          resultId,
          fileName: result.fileName,
          width: widths[index] ?? null,
        })
      }
      outputs.push({ source: toSourceSummary(source), images })
    }
    const order = inputOrder(run.definition)
    return outputs.sort(
      (left, right) =>
        order.indexOf(left.source.id) - order.indexOf(right.source.id),
    )
  }

  /** Writes every finished image of a run into one zip file at `destination`. */
  async writeRunArchive(
    actor: Actor,
    runId: string,
    destination: string,
  ): Promise<WrittenRunArchive> {
    const run = await this.#ownedRun(actor, runId)
    const workflow =
      run.workflowId === null
        ? null
        : await this.#deps.workflows.findById(run.workflowId)
    return writeRunArchive(
      this.#deps.results,
      actor,
      await this.runOutputs(actor, runId),
      destination,
      runArchiveName(workflow?.name, run.id),
    )
  }

  /** A run's zip file as a download; the file is removed once it has been read. */
  openRunArchive(actor: Actor, runId: string): Promise<OpenedRunArchive> {
    return openRunArchive(this.#deps.workRoot, (destination) =>
      this.writeRunArchive(actor, runId, destination),
    )
  }

  /** Called when a Job ends, so a run that has finished is closed and its work images removed. */
  async onJobFinished(job: JobRecord): Promise<void> {
    if (job.workflowRunId === null) return
    const run = await this.#deps.workflows.findRun(job.workflowRunId)
    if (run === null) return
    await this.#view(run)
    this.#announce(job.ownerId)
  }

  #announceUpdated(userId: string, record: WorkflowRecord): void {
    this.#deps.changes.publish(userId, {
      type: 'workflow.updated',
      workflowId: record.id,
      revision: record.revision,
      updatedAt: record.updatedAt,
    })
  }

  async #workflowView(record: WorkflowRecord): Promise<WorkflowView> {
    const { workflows } = this.#deps
    const undo = await workflows.findEntry(record.id, record.historyCursor - 1)
    const redo = await workflows.findEntry(record.id, record.historyCursor)
    return {
      id: record.id,
      name: record.name,
      ...record.definition,
      revision: record.revision,
      canUndo: undo !== null,
      canRedo: redo !== null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }
  }

  /** The workflow, if it is still on the revision the caller saw. */
  async #current(
    actor: Actor,
    id: string,
    revision: number,
  ): Promise<WorkflowRecord> {
    const record = await this.#owned(actor, id)
    if (record.revision !== revision) {
      throw new ConflictError(STALE_WORKFLOW_MESSAGE)
    }
    return record
  }

  #plan(definition: WorkflowDefinition, change: WorkflowChange) {
    try {
      return planWorkflowChange(definition, change)
    } catch (error) {
      throw asValidation(error)
    }
  }

  #announce(userId: string): void {
    this.#deps.changes.publish(userId, { type: 'workflows.changed' })
  }

  async #view(run: WorkflowRunRecord): Promise<RunView> {
    const { jobDao, workflows, clock, workRoot } = this.#deps
    const jobs = await jobDao.list(run.ownerId, { workflowRunId: run.id })
    const state =
      run.state === RunState.Running ? deriveRunState(jobs) : run.state
    let finishedAt = run.finishedAt
    if (state !== run.state) {
      finishedAt = isoNow(clock)
      await workflows.updateRunState(run.id, state, finishedAt)
      await rm(runWorkDirectory(workRoot, run.id), {
        recursive: true,
        force: true,
      })
    }
    const counts = countJobs(jobs)
    const errors = new Set<string>()
    for (const job of jobs) if (job.error !== null) errors.add(job.error)
    let progress = 0
    for (const job of jobs) progress += isTerminal(job.state) ? 1 : job.progress
    return {
      id: run.id,
      workflowId: run.workflowId,
      sourceIds: [...run.definition.inputs],
      state,
      createdAt: run.createdAt,
      finishedAt,
      jobs: counts,
      progress: jobs.length === 0 ? 1 : progress / jobs.length,
      errors: [...errors],
      items: runItems(run.definition.inputs, jobs),
    }
  }

  #emptyDefinition(name: string): WorkflowDefinition {
    const { pipeline, inputs, output, canvasSize } = createWorkflow(name)
    return { pipeline, inputs, output, canvasSize }
  }

  #parseDefinition(definition: WorkflowDefinition): WorkflowDefinition {
    const parsed = WorkflowDefinitionSchema.safeParse(definition)
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? 'The workflow is not valid.',
      )
    }
    return parsed.data
  }

  /** Every image the workflow names exists and is the User's, and every AI tool is one the server has. */
  async #checkDefinition(
    actor: Actor,
    definition: WorkflowDefinition,
  ): Promise<void> {
    const ids = new Set([
      ...definition.inputs,
      ...pipelineOperandSourceIds(definition.pipeline),
    ])
    for (const step of leafSteps(definition.pipeline)) {
      if (step.kind === 'ai') this.#deps.registry.get(step.tool)
    }
    for (const id of ids) {
      const source = await this.#deps.sources.findById(id)
      if (source === null || source.ownerId !== actor.userId) {
        throw new ValidationError(MISSING_SOURCE)
      }
    }
  }

  /** Refuses a Sharp step that is on and not set up, saying which one. */
  #requireSetUp(definition: WorkflowDefinition): void {
    for (const step of leafSteps(definition.pipeline)) {
      if (step.kind !== 'sharp' || !step.enabled) continue
      const problem = stepProblem(step)
      if (problem !== undefined) {
        throw new ValidationError(`${pipelineStepLabel(step)}: ${problem}`)
      }
    }
  }

  async #requireFreeName(
    actor: Actor,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const existing = await this.#deps.workflows.listByOwner(actor.userId)
    const taken = existing.some(
      (workflow) =>
        workflow.id !== exceptId &&
        normalise(workflow.name) === normalise(name),
    )
    if (taken) throw new ConflictError(DUPLICATE_NAME)
  }

  async #owned(actor: Actor, id: string): Promise<WorkflowRecord> {
    return requireOwned(
      actor,
      await this.#deps.workflows.findById(id),
      MISSING_WORKFLOW,
    )
  }

  async #ownedRun(actor: Actor, id: string): Promise<WorkflowRunRecord> {
    return requireOwned(
      actor,
      await this.#deps.workflows.findRun(id),
      MISSING_RUN,
    )
  }
}
