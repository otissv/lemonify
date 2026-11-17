import { z } from 'zod'

/** The longest name a step can be given. */
export const MAX_STEP_NAME_LENGTH = 60

/** Whether a step is switched on; a step is on unless it says otherwise. */
export const stepEnabledSchema = z.boolean().default(true)

/** What a person calls the step; the tool's own name is used when there is none. */
export const stepNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_STEP_NAME_LENGTH)
  .optional()
