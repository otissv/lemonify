import type { Knex } from 'knex'

import { authTables } from './20260101000100-auth-tables.ts'
import { libraryTables } from './20260101000200-library-tables.ts'
import { workTables } from './20260101000300-work-tables.ts'
import { openImageSteps } from './20260101000400-open-image-steps.ts'
import { layers } from './20260101000500-layers.ts'
import { layersOnly } from './20260101000600-layers-only.ts'
import { documentOrder } from './20260101000700-document-order.ts'
import { keybindings } from './20260101000800-keybindings.ts'
import { workflowPipelines } from './20260101000900-workflow-pipelines.ts'
import { workflowHistory } from './20260101001000-workflow-history.ts'

export type Migration = {
  name: string
  up: (database: Knex) => Promise<void>
  down: (database: Knex) => Promise<void>
}

/** Every schema change, oldest first. Add new ones at the end, never edit old ones. */
export const MIGRATIONS: readonly Migration[] = [
  authTables,
  libraryTables,
  workTables,
  openImageSteps,
  layers,
  layersOnly,
  documentOrder,
  keybindings,
  workflowPipelines,
  workflowHistory,
]
