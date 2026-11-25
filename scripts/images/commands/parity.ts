import type { AiToolRegistry } from '../../../src/server/ai/ai-tool-registry.ts'
import type { WorkflowChange } from '../../../src/features/workflows/workflow-change.ts'
import type { DocumentChange } from '../../../src/features/pipeline/document-change.ts'
import type { DocumentBundleService } from '../../../src/server/services/document-bundle-service.ts'
import type { DocumentService } from '../../../src/server/services/document-service.ts'
import type { KeybindingService } from '../../../src/server/services/keybinding-service.ts'
import type { JobService } from '../../../src/server/services/job-service.ts'
import type { RenderService } from '../../../src/server/services/render-service.ts'
import type { ResultService } from '../../../src/server/services/result-service.ts'
import type { SourceService } from '../../../src/server/services/source-service.ts'
import type { UserService } from '../../../src/server/services/user-service.ts'
import type { WorkflowService } from '../../../src/server/services/workflow-service.ts'
import type { ImageCommand } from '../cli.ts'
import {
  documentCreateCommand,
  documentDeleteCommand,
  documentExportCommand,
  documentImportCommand,
  documentListCommand,
  documentMoveCommand,
  documentPreviewCommand,
  documentRedoCommand,
  documentRenameCommand,
  documentShowCommand,
  documentUndoCommand,
} from './document.ts'
import {
  documentStepAddCommand,
  documentStepDisableCommand,
  documentStepEnableCommand,
  documentStepMoveCommand,
  documentStepRemoveCommand,
  documentStepGroupCommand,
  documentStepRenameCommand,
  documentStepUngroupCommand,
  documentStepRunCommand,
  documentStepSetCommand,
} from './document-step.ts'
import { documentCanvasCommand } from './document-canvas.ts'
import { documentStepResetCommand } from './document-step-reset.ts'
import { aiCatalogueCommand, aiToolsCommand } from './ai.ts'
import { exportCommand, exportFormatsCommand } from './export.ts'
import {
  keysExportCommand,
  keysImportCommand,
  keysListCommand,
  keysResetCommand,
  keysSetCommand,
  keysUnsetCommand,
} from './keys.ts'
import { jobCancelCommand, jobListCommand, jobShowCommand } from './job.ts'
import {
  resultClearUnusedCommand,
  resultDeleteCommand,
  resultListCommand,
  resultSaveCommand,
  resultShowCommand,
} from './result.ts'
import {
  sourceAddCommand,
  sourceDeleteCommand,
  sourceListCommand,
} from './source.ts'
import { userListCommand } from './user.ts'
import {
  workflowCancelCommand,
  workflowCreateCommand,
  workflowDeleteCommand,
  workflowListCommand,
  workflowPreviewCommand,
  workflowRedoCommand,
  workflowRenameCommand,
  workflowResultsCommand,
  workflowRunCommand,
  workflowRunDeleteCommand,
  workflowRunShowCommand,
  workflowRunsCommand,
  workflowShowCommand,
  workflowUndoCommand,
  workflowUpdateCommand,
} from './workflow.ts'

/**
 * The website and the command line have exactly the same features. Both call
 * the same services, so how a feature behaves cannot differ; these tables make
 * sure each feature is also reachable from both. Every public method of every
 * service must be listed, and the compiler rejects a method that is missing.
 * `parity.test.ts` checks that the tables match the services and that every
 * command they name is registered. Add the command in the same change as the
 * feature, never later.
 */

/** How a service method reaches the command line. */
export type Coverage =
  | ReadonlyArray<ImageCommand>
  /** Only about what is on the screen, so the command line has nothing to match. */
  | { screenOnly: string }
  /** Used by other code, not something a person does. */
  | { internal: string }

/** The command that makes each kind of edit to a document's pipeline. */
export const DOCUMENT_CHANGE_COMMANDS = {
  'add-step': [documentStepAddCommand],
  'remove-step': [documentStepRemoveCommand],
  'move-step': [documentStepMoveCommand],
  'group-steps': [documentStepGroupCommand],
  ungroup: [documentStepUngroupCommand],
  'rename-step': [documentStepRenameCommand],
  'set-canvas': [documentCanvasCommand],
  'set-enabled': [documentStepEnableCommand, documentStepDisableCommand],
  'set-blend': [documentStepSetCommand],
  'set-layer': [documentStepSetCommand],
  'set-options': [documentStepSetCommand],
  'set-settings': [documentStepSetCommand],
  'set-image': [documentStepSetCommand],
  'set-sub-document': [documentStepSetCommand],
  'reset-step': [documentStepResetCommand],
  'restore-step': [documentUndoCommand],
} as const satisfies Record<DocumentChange['type'], ReadonlyArray<ImageCommand>>

/** The command that makes each kind of edit to a workflow's pipeline, inputs and Output settings. The ones a document has go through `workflow update`, which writes the whole workflow as one change. */
export const WORKFLOW_CHANGE_COMMANDS = {
  'set-inputs': [workflowUpdateCommand],
  'set-output': [workflowUpdateCommand],
  'set-canvas-size': [workflowUpdateCommand],
  replace: [workflowUpdateCommand],
} as const satisfies Record<
  Exclude<WorkflowChange['type'], DocumentChange['type']>,
  ReadonlyArray<ImageCommand>
>

const BACKGROUND = { internal: 'runs by itself as part of the app' }
const LIFECYCLE = { internal: 'called by another service when something ends' }

export const DOCUMENT_COMMANDS = {
  create: [documentCreateCommand],
  createBlank: [documentCreateCommand],
  createFromPipeline: [documentImportCommand],
  list: [documentListCommand],
  get: [documentShowCommand],
  rename: [documentRenameCommand],
  move: [documentMoveCommand],
  delete: [documentDeleteCommand],
  change: [documentStepAddCommand, documentStepSetCommand],
  undo: [documentUndoCommand],
  redo: [documentRedoCommand],
} as const satisfies Record<keyof DocumentService, Coverage>

export const SOURCE_COMMANDS = {
  upload: [sourceAddCommand],
  list: [sourceListCommand],
  delete: [sourceDeleteCommand],
  get: { internal: 'other services look a source up by id' },
  pathOf: { internal: 'the file a source is stored in' },
  open: { screenOnly: 'serves the picture to the page' },
  sweepOrphans: BACKGROUND,
} as const satisfies Record<keyof SourceService, Coverage>

export const RESULT_COMMANDS = {
  list: [resultListCommand],
  get: [resultShowCommand],
  open: [resultSaveCommand],
  delete: [resultDeleteCommand],
  usedBytes: [resultListCommand],
  assertWithinQuota: { internal: 'checked before a result is stored' },
  record: { internal: 'stores what a finished job made' },
  find: { internal: 'looks for a result a job would make again' },
  findPath: { internal: 'the file a result is stored in' },
  onDocumentDeleted: LIFECYCLE,
  sweepOrphans: BACKGROUND,
} as const satisfies Record<keyof ResultService, Coverage>

export const JOB_COMMANDS = {
  list: [jobListCommand],
  get: [jobShowCommand],
  cancel: [jobCancelCommand],
  enqueue: { internal: 'the services queue work; a person does not' },
  build: { internal: 'makes a job from a request' },
  follow: {
    screenOnly:
      'streams a job’s progress to the page; commands wait for the job instead',
  },
  waitFor: {
    internal: 'how a command waits; the website follows jobs instead',
  },
  sweepFinished: BACKGROUND,
} as const satisfies Record<keyof JobService, Coverage>

export const WORKFLOW_COMMANDS = {
  create: [workflowCreateCommand],
  list: [workflowListCommand],
  get: [workflowShowCommand],
  change: [workflowUpdateCommand],
  rename: [workflowRenameCommand],
  undo: [workflowUndoCommand],
  redo: [workflowRedoCommand],
  delete: [workflowDeleteCommand],
  run: [workflowRunCommand],
  getRun: [workflowRunShowCommand],
  listRuns: [workflowRunsCommand],
  cancelRun: [workflowCancelCommand],
  deleteRun: [workflowRunDeleteCommand],
  runOutputs: [workflowResultsCommand],
  writeRunArchive: [workflowResultsCommand],
  openRunArchive: [workflowResultsCommand],
  onJobFinished: LIFECYCLE,
} as const satisfies Record<keyof WorkflowService, Coverage>

export const RENDER_COMMANDS = {
  requestExport: [exportCommand],
  exportFormats: [exportFormatsCommand],
  requestAiStep: [documentStepRunCommand],
  clearUnusedResults: [resultClearUnusedCommand],
  requestPreview: [documentPreviewCommand],
  requestThumbnails: { screenOnly: 'the small pictures in the step list' },
  requestWorkflowPreview: [workflowPreviewCommand],
  requestWorkflowThumbnails: {
    screenOnly: 'the small pictures under each workflow node',
  },
  fetchWorkflow: { screenOnly: 'serving workflow diagram pictures' },
  fetch: { screenOnly: 'serves a rendered picture to the page' },
} as const satisfies Record<keyof RenderService, Coverage>

export const BUNDLE_COMMANDS = {
  exportDocument: [documentExportCommand],
  openExport: [documentExportCommand],
  importDocument: [documentImportCommand],
  importStream: [documentImportCommand],
  fileNameFor: { internal: 'names the file an export is saved as' },
  resolveDestination: { internal: 'works out where the command writes' },
} as const satisfies Record<keyof DocumentBundleService, Coverage>

export const KEYBINDING_COMMANDS = {
  get: [keysListCommand, keysExportCommand],
  save: [keysImportCommand],
  set: [keysSetCommand, keysUnsetCommand],
  reset: [keysResetCommand],
} as const satisfies Record<keyof KeybindingService, Coverage>

export const USER_COMMANDS = {
  list: [userListCommand],
  resolveActor: { internal: 'how a command picks the user it acts as' },
} as const satisfies Record<keyof UserService, Coverage>

export const AI_TOOL_COMMANDS = {
  list: [aiToolsCommand],
  catalogue: [aiCatalogueCommand],
  get: { internal: 'the services look a tool up to run or batch it' },
} as const satisfies Record<keyof AiToolRegistry, Coverage>
