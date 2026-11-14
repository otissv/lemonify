import type { z } from 'zod'

import { ImageOptionsError } from './errors.ts'

/** Validates `input` against `schema`, turning Zod issues into one readable `ImageOptionsError`. */
export function parseWithSchema<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
): z.output<TSchema> {
  const result = schema.safeParse(input)
  if (result.success) return result.data
  const issues: string[] = []
  for (const issue of result.error.issues) {
    const field = issue.path.map(String).join('.')
    issues.push(field ? `${field}: ${issue.message}` : issue.message)
  }
  throw new ImageOptionsError(issues)
}
