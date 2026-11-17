import type { WorkflowHistoryPatch } from '@/features/workflows/workflow-change'
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
  /** The position the next change will take; entries below it are applied. */
  historyCursor: number
  createdAt: string
  updatedAt: string
}

export type WorkflowHistoryEntryRecord = {
  workflowId: string
  position: number
  patch: WorkflowHistoryPatch
  createdAt: string
}

export type RecordedWorkflowChange = {
  id: string
  expectedRevision: number
  definition: WorkflowDefinition
  patch: WorkflowHistoryPatch
  maxEntries: number
  now: string
}

export type MovedWorkflowCursor = {
  id: string
  expectedRevision: number
  definition: WorkflowDefinition
  cursor: number
  now: string
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
  rename(id: string, name: string, now: string): Promise<WorkflowRecord>
  /**
   * Writes the new definition, drops the undone entries, records the patch at
   * the cursor, trims the oldest entries beyond `maxEntries` and raises the
   * revision, all in one transaction; a ConflictError when `expectedRevision`
   * is not the stored one.
   */
  applyChange(change: RecordedWorkflowChange): Promise<WorkflowRecord>
  /** Writes the definition an undo or redo produced and moves the cursor, with the same revision check. */
  moveCursor(move: MovedWorkflowCursor): Promise<WorkflowRecord>
  findEntry(
    workflowId: string,
    position: number,
  ): Promise<WorkflowHistoryEntryRecord | null>
  /** Removes the Workflow and its Edit history; its runs stay. */
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
