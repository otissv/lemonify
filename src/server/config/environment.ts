import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'

import { ValidationError } from '../errors.ts'

const ENV_FILE = '.env'

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function readEnvFile(file: string): NodeJS.ProcessEnv {
  try {
    return parseEnv(readFileSync(file, 'utf8'))
  } catch (error) {
    if (isMissingFile(error)) return {}
    throw new ValidationError(
      `The settings file ${file} could not be read: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * The settings the app starts with: the `.env` file in `cwd`, when there is
 * one, under the process environment, so a variable that is set wins.
 */
export function readEnvironment(
  cwd: string = process.cwd(),
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return { ...readEnvFile(path.join(cwd, ENV_FILE)), ...environment }
}
