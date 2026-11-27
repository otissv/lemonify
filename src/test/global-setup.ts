import { randomBytes } from 'node:crypto'

import type { TestProject } from 'vitest/node'

import {
  createTemplateDatabase,
  dropTestDatabases,
} from '../server/testing/test-database.ts'

/** Migrates one template database for the run, and drops the run's databases when it ends. */
export default async function setup(
  project: TestProject,
): Promise<() => Promise<void>> {
  const run = randomBytes(4).toString('hex')
  await createTemplateDatabase(run)
  project.provide('testRun', run)
  return () => dropTestDatabases(run)
}
