import type { ImageCommand } from '../cli.ts'
import { formatsCommand } from './formats.ts'
import { infoCommand } from './info.ts'
import { modelsCommand } from './models.ts'
import { schemaCommand } from './schema.ts'
import { sharpCommand } from './sharp.ts'
import { upscaleCommand } from './upscale.ts'
import { userListCommand } from './user.ts'
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
  documentStepGroupCommand,
  documentStepRenameCommand,
  documentStepUngroupCommand,
  documentStepEnableCommand,
  documentStepMoveCommand,
  documentStepRemoveCommand,
  documentStepRunCommand,
  documentStepSetCommand,
} from './document-step.ts'
import { documentCanvasCommand } from './document-canvas.ts'
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
  keysExportCommand,
  keysImportCommand,
  keysListCommand,
  keysResetCommand,
  keysSetCommand,
  keysUnsetCommand,
} from './keys.ts'
import { workerCommand } from './worker.ts'
import {
  workflowCancelCommand,
  workflowCreateCommand,
  workflowDeleteCommand,
  workflowListCommand,
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

/** Every `pnpm images` subcommand, in the order the help lists them. */
export const COMMANDS: readonly ImageCommand[] = [
  sharpCommand,
  infoCommand,
  upscaleCommand,
  modelsCommand,
  formatsCommand,
  schemaCommand,
  userListCommand,
  keysListCommand,
  keysSetCommand,
  keysUnsetCommand,
  keysResetCommand,
  keysExportCommand,
  keysImportCommand,
  sourceAddCommand,
  sourceListCommand,
  sourceDeleteCommand,
  documentCreateCommand,
  documentListCommand,
  documentShowCommand,
  documentRenameCommand,
  documentMoveCommand,
  documentDeleteCommand,
  documentExportCommand,
  documentPreviewCommand,
  documentImportCommand,
  documentUndoCommand,
  documentRedoCommand,
  documentCanvasCommand,
  documentStepAddCommand,
  documentStepRemoveCommand,
  documentStepMoveCommand,
  documentStepSetCommand,
  documentStepEnableCommand,
  documentStepDisableCommand,
  documentStepGroupCommand,
  documentStepRenameCommand,
  documentStepUngroupCommand,
  documentStepRunCommand,
  exportCommand,
  workflowCreateCommand,
  workflowShowCommand,
  workflowListCommand,
  workflowUpdateCommand,
  workflowRenameCommand,
  workflowUndoCommand,
  workflowRedoCommand,
  workflowDeleteCommand,
  workflowRunCommand,
  workflowResultsCommand,
  workflowRunsCommand,
  workflowCancelCommand,
  workflowRunDeleteCommand,
  workflowRunShowCommand,
  resultListCommand,
  resultShowCommand,
  resultDeleteCommand,
  resultSaveCommand,
  resultClearUnusedCommand,
  jobListCommand,
  jobShowCommand,
  jobCancelCommand,
  workerCommand,
]
