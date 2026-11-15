import { AiCancelledError, AiEngineError } from '../ai/ai-engine.ts'
import { AppError } from '../errors.ts'
import { RenderError } from '../tools/render-error.ts'
import { JobCancelledError, StaleJobError } from './job-handler.ts'
import { JobState } from './job-types.ts'
import type { JobOutcome } from './job-types.ts'

const UNEXPECTED = 'The job failed unexpectedly.'

/** The words a User may read about a failure; anything not meant for them becomes a generic line (the detail is logged). */
export function failureMessage(error: unknown): string {
  if (
    error instanceof AppError ||
    error instanceof RenderError ||
    error instanceof AiEngineError
  ) {
    return error.message
  }
  return UNEXPECTED
}

/** Whether an error means the work was stopped on purpose rather than broken. */
export function isStop(error: unknown): boolean {
  return (
    error instanceof AiCancelledError ||
    error instanceof JobCancelledError ||
    error instanceof StaleJobError
  )
}

export function outcomeOfError(error: unknown): JobOutcome {
  if (isStop(error)) return { state: JobState.Cancelled }
  return { state: JobState.Failed, error: failureMessage(error) }
}
