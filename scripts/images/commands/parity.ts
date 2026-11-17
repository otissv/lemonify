import type { DocumentChange } from '../../../src/features/pipeline/document-change.ts'
import type { DocumentBundleService } from '../../../src/server/services/document-bundle-service.ts'
import type { DocumentService } from '../../../src/server/services/document-service.ts'
import type { JobService } from '../../../src/server/services/job-service.ts'
import type { RenderService } from '../../../src/server/services/render-service.ts'
import type { ResultService } from '../../../src/server/services/result-service.ts'
import type { SourceService } from '../../../src/server/services/source-service.ts'
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
  documentStepRenameCommand,
  documentStepRunCommand,
  documentStepSetCommand,
} from './document-step.ts'
import { exportCommand } from './export.ts'
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
import {
  workflowCancelCommand,
  workflowCreateCommand,
  workflowDeleteCommand,
  workflowListCommand,
  workflowResultsCommand,
  workflowRunCommand,
  workflowRunDeleteCommand,
  workflowRunShowCommand,
  workflowRunsCommand,
  workflowShowCommand,
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
  'rename-step': [documentStepRenameCommand],
  'set-enabled': [documentStepEnableCommand, documentStepDisableCommand],
  'set-blend': [documentStepSetCommand],
  'set-layer': [documentStepSetCommand],
  'set-options': [documentStepSetCommand],
  'set-settings': [documentStepSetCommand],
  'set-source': [documentStepSetCommand],
} as const satisfies Record<DocumentChange['type'], ReadonlyArray<ImageCommand>>

const BACKGROUND = { internal: 'runs by itself as part of the app' }
const LIFECYCLE = { internal: 'called by another service when something ends' }

export const DOCUMENT_COMMANDS = {
  create: [documentCreateCommand],
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
  update: [workflowUpdateCommand],
  delete: [workflowDeleteCommand],
  run: [workflowRunCommand],
  getRun: [workflowRunShowCommand],
  listRuns: [workflowRunsCommand],
  cancelRun: [workflowCancelCommand],
  deleteRun: [workflowRunDeleteCommand],
  runOutputs: [workflowResultsCommand],
  onJobFinished: LIFECYCLE,
} as const satisfies Record<keyof WorkflowService, Coverage>

export const RENDER_COMMANDS = {
  requestExport: [exportCommand],
  requestAiStep: [documentStepRunCommand],
  clearUnusedResults: [resultClearUnusedCommand],
  requestPreview: [documentPreviewCommand],
  requestThumbnails: { screenOnly: 'the small pictures in the step list' },
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
