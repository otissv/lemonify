import { rm } from 'node:fs/promises'

import {
  pipelineStepLabel,
  stepProblem,
} from '@/features/pipeline/step-problems'
import { stepOperandSourceIds } from '@/features/pipeline/image-operands'
import {
  planSegments,
  toSharpStep,
  workflowProblem,
} from '@/features/workflows/segments'
import {
  WorkflowGraphSchema,
  createWorkflow,
} from '@/features/workflows/workflow'
import type { WorkflowGraph } from '@/features/workflows/workflow'
import { WorkflowNameSchema } from '@/features/workflows/workflow'
import { WorkflowNodeKind } from '@/features/workflows/workflow-graph'

import type { AiToolRegistry } from '../ai/ai-tool-registry.ts'
import type { JobDao } from '../dao/job-dao.ts'
import type { SourceDao } from '../dao/source-dao.ts'
import { RunState } from '../dao/workflow-dao.ts'
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
import { runWorkDirectory, segmentJobSpec } from '../workflows/run-jobs.ts'
import type { SourceSummary } from '@/features/documents/document'
import type { JobService } from './job-service.ts'
import type { ResultService } from './result-service.ts'
import { toSourceSummary } from './source-service.ts'

const MISSING_WORKFLOW = 'That workflow does not exist.'
const MISSING_RUN = 'That run does not exist.'
const DUPLICATE_NAME = 'A workflow with this name already exists.'
const MISSING_SOURCE = 'An image in this workflow no longer exists.'
const CANCEL_PASSES = 3

export type WorkflowView = {
  id: string
  name: string
  nodes: WorkflowGraph['nodes']
  edges: WorkflowGraph['edges']
  revision: number
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
  state: RunState
  createdAt: string
  finishedAt: string | null
  jobs: RunJobCounts
  /** 0 to 1 across every Job of the run, so far. */
  progress: number
  /** The plain-words reasons Jobs of the run failed, without repeats. */
  errors: string[]
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
}

function toView(record: WorkflowRecord): WorkflowView {
  return {
    id: record.id,
    name: record.name,
    nodes: record.graph.nodes,
    edges: record.graph.edges,
    revision: record.revision,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
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

function outputWidths(graph: WorkflowGraph): number[] {
  for (const node of graph.nodes) {
    if (node.kind === WorkflowNodeKind.Output) return [...node.settings.widths]
  }
  return []
}

/** The Sources in the order the Input step lists them, so a run's outputs come back in that order whatever order its Jobs finished in. */
function inputOrder(graph: WorkflowGraph): string[] {
  for (const node of graph.nodes) {
    if (node.kind === WorkflowNodeKind.Input) return [...node.sourceIds]
  }
  return []
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
    graph?: WorkflowGraph,
  ): Promise<WorkflowView> {
    const { workflows, clock, ids } = this.#deps
    const cleaned = cleanName(name)
    await this.#requireFreeName(actor, cleaned)
    const chosen = graph ?? this.#emptyGraph(cleaned)
    await this.#checkGraph(actor, chosen)
    const now = isoNow(clock)
    const record: WorkflowRecord = {
      id: ids.next(),
      ownerId: actor.userId,
      name: cleaned,
      graph: chosen,
      revision: 0,
      createdAt: now,
      updatedAt: now,
    }
    await workflows.insert(record)
    return toView(record)
  }

  async list(actor: Actor): Promise<WorkflowView[]> {
    const records = await this.#deps.workflows.listByOwner(actor.userId)
    return records.map(toView)
  }

  async get(actor: Actor, id: string): Promise<WorkflowView> {
    return toView(await this.#owned(actor, id))
  }

  /** Saves a new name and graph; `revision` is the one the caller last saw. */
  async update(
    actor: Actor,
    id: string,
    revision: number,
    changes: { name: string; graph: WorkflowGraph },
  ): Promise<WorkflowView> {
    await this.#owned(actor, id)
    const name = cleanName(changes.name)
    await this.#requireFreeName(actor, name, id)
    const graph = this.#parseGraph(changes.graph)
    await this.#checkGraph(actor, graph)
    const saved = await this.#deps.workflows.update(
      id,
      revision,
      { name, graph },
      isoNow(this.#deps.clock),
    )
    return toView(saved)
  }

  async delete(actor: Actor, id: string): Promise<void> {
    await this.#owned(actor, id)
    await this.#deps.workflows.delete(id)
  }

  /** Starts a run: one Job per Source for the first segment. Everything that can be checked is checked first, so a run never starts half-valid. */
  async run(actor: Actor, id: string): Promise<RunView> {
    const workflow = await this.#owned(actor, id)
    const { graph } = workflow
    const problem = workflowProblem(graph)
    if (problem !== undefined) throw new ValidationError(problem)
    await this.#checkGraph(actor, graph)
    this.#requireSetUp(graph)
    const input = graph.nodes.find(
      ({ kind }) => kind === WorkflowNodeKind.Input,
    )
    const sourceIds =
      input?.kind === WorkflowNodeKind.Input
        ? [...new Set(input.sourceIds)]
        : []
    const { workflows, jobs, registry, clock, ids } = this.#deps
    const run: WorkflowRunRecord = {
      id: ids.next(),
      workflowId: workflow.id,
      ownerId: actor.userId,
      graph,
      state: RunState.Running,
      createdAt: isoNow(clock),
      finishedAt: null,
    }
    await workflows.insertRun(run)
    const segments = planSegments(graph)
    try {
      await jobs.enqueue(
        actor,
        sourceIds.map((sourceId) =>
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
  }

  /** What a run made, grouped by the Source each image came from; only finished items appear. */
  async runOutputs(actor: Actor, runId: string): Promise<RunOutput[]> {
    const run = await this.#ownedRun(actor, runId)
    const { jobDao, sources, results } = this.#deps
    const widths = outputWidths(run.graph)
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
    const order = inputOrder(run.graph)
    return outputs.sort(
      (left, right) =>
        order.indexOf(left.source.id) - order.indexOf(right.source.id),
    )
  }

  /** Called when a Job ends, so a run that has finished is closed and its work images removed. */
  async onJobFinished(job: JobRecord): Promise<void> {
    if (job.workflowRunId === null) return
    const run = await this.#deps.workflows.findRun(job.workflowRunId)
    if (run !== null) await this.#view(run)
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
      state,
      createdAt: run.createdAt,
      finishedAt,
      jobs: counts,
      progress: jobs.length === 0 ? 1 : progress / jobs.length,
      errors: [...errors],
    }
  }

  #emptyGraph(name: string): WorkflowGraph {
    const { nodes, edges } = createWorkflow(name)
    return { nodes, edges }
  }

  #parseGraph(graph: WorkflowGraph): WorkflowGraph {
    const parsed = WorkflowGraphSchema.safeParse(graph)
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? 'The workflow is not valid.',
      )
    }
    return parsed.data
  }

  /** Every Source the workflow names exists and is the User's, and every AI tool is one the server has. */
  async #checkGraph(actor: Actor, graph: WorkflowGraph): Promise<void> {
    const ids = new Set<string>()
    for (const node of graph.nodes) {
      if (node.kind === WorkflowNodeKind.Input) {
        for (const id of node.sourceIds) ids.add(id)
      } else if (node.kind === WorkflowNodeKind.Sharp) {
        for (const id of stepOperandSourceIds(toSharpStep(node))) ids.add(id)
      } else if (node.kind === 'ai') {
        this.#deps.registry.get(node.tool)
      }
    }
    for (const id of ids) {
      const source = await this.#deps.sources.findById(id)
      if (source === null || source.ownerId !== actor.userId) {
        throw new ValidationError(MISSING_SOURCE)
      }
    }
  }

  /** Refuses a Sharp step that is not set up, saying which one. */
  #requireSetUp(graph: WorkflowGraph): void {
    for (const node of graph.nodes) {
      if (node.kind !== WorkflowNodeKind.Sharp) continue
      const step = toSharpStep(node)
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
