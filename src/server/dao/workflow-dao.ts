import type {
  RunCanvasMode,
  WorkflowDefinition,
} from '@/features/workflows/workflow'

export const STALE_WORKFLOW_MESSAGE =
  'This workflow was changed somewhere else. Reload it to see the latest version.'

export type WorkflowRecord = {
  id: string
  ownerId: string
  name: string
  definition: WorkflowDefinition
  revision: number
  createdAt: string
  updatedAt: string
}

export enum RunState {
  Running = 'running',
  Done = 'done',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

export type WorkflowRunRecord = {
  id: string
  /** Null once the Workflow it came from was deleted; the run keeps its own copy of the definition. */
  workflowId: string | null
  ownerId: string
  /** The definition as it was when the run started, so editing the Workflow mid-run changes nothing. */
  definition: WorkflowDefinition
  /** Which canvas the run draws on, chosen when it started. */
  canvasMode: RunCanvasMode
  state: RunState
  createdAt: string
  finishedAt: string | null
}

/** Storage for Workflows and their runs. */
export interface WorkflowDao {
  insert(workflow: WorkflowRecord): Promise<void>
  findById(id: string): Promise<WorkflowRecord | null>
  /** Most recently changed first. */
  listByOwner(ownerId: string): Promise<WorkflowRecord[]>
  /** Saves a new name and definition and raises the revision; a ConflictError when `expectedRevision` is not the stored one. */
  update(
    id: string,
    expectedRevision: number,
    changes: { name: string; definition: WorkflowDefinition },
    now: string,
  ): Promise<WorkflowRecord>
  delete(id: string): Promise<void>
  insertRun(run: WorkflowRunRecord): Promise<void>
  /** Removes a run that never got started, with any Jobs it has. */
  deleteRun(id: string): Promise<void>
  findRun(id: string): Promise<WorkflowRunRecord | null>
  /** Newest first, optionally only the runs of one Workflow. */
  listRuns(ownerId: string, workflowId?: string): Promise<WorkflowRunRecord[]>
  updateRunState(
    id: string,
    state: RunState,
    finishedAt: string | null,
  ): Promise<void>
}
