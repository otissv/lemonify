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
  documentListCommand,
  documentRedoCommand,
  documentShowCommand,
  documentUndoCommand,
} from './document.ts'
import {
  documentStepAddCommand,
  documentStepDisableCommand,
  documentStepEnableCommand,
  documentStepMoveCommand,
  documentStepRemoveCommand,
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
import { workerCommand } from './worker.ts'
import {
  workflowCancelCommand,
  workflowCreateCommand,
  workflowDeleteCommand,
  workflowListCommand,
  workflowResultsCommand,
  workflowRunCommand,
  workflowRunDeleteCommand,
  workflowRunsCommand,
  workflowShowCommand,
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
  sourceAddCommand,
  sourceListCommand,
  sourceDeleteCommand,
  documentCreateCommand,
  documentListCommand,
  documentShowCommand,
  documentDeleteCommand,
  documentUndoCommand,
  documentRedoCommand,
  documentStepAddCommand,
  documentStepRemoveCommand,
  documentStepMoveCommand,
  documentStepSetCommand,
  documentStepEnableCommand,
  documentStepDisableCommand,
  exportCommand,
  workflowCreateCommand,
  workflowShowCommand,
  workflowListCommand,
  workflowUpdateCommand,
  workflowDeleteCommand,
  workflowRunCommand,
  workflowResultsCommand,
  workflowRunsCommand,
  workflowCancelCommand,
  workflowRunDeleteCommand,
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
