// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { WorkflowChangeSchema } from '../../../src/features/workflows/workflow-change.ts'
import { DocumentChangeSchema } from '../../../src/features/pipeline/document-change.ts'
import { DocumentBundleService } from '../../../src/server/services/document-bundle-service.ts'
import { DocumentService } from '../../../src/server/services/document-service.ts'
import { KeybindingService } from '../../../src/server/services/keybinding-service.ts'
import { JobService } from '../../../src/server/services/job-service.ts'
import { RenderService } from '../../../src/server/services/render-service.ts'
import { ResultService } from '../../../src/server/services/result-service.ts'
import { SourceService } from '../../../src/server/services/source-service.ts'
import { WorkflowService } from '../../../src/server/services/workflow-service.ts'
import { COMMANDS } from './index.ts'
import {
  BUNDLE_COMMANDS,
  DOCUMENT_CHANGE_COMMANDS,
  DOCUMENT_COMMANDS,
  JOB_COMMANDS,
  KEYBINDING_COMMANDS,
  RENDER_COMMANDS,
  RESULT_COMMANDS,
  SOURCE_COMMANDS,
  WORKFLOW_CHANGE_COMMANDS,
  WORKFLOW_COMMANDS,
} from './parity.ts'
import type { Coverage } from './parity.ts'

type ChangeShape = { shape: { type: { value: string } } }
type ChangeUnion = { options: ReadonlyArray<ChangeShape | ChangeUnion> }

/** Every `type` the change schema accepts, including those in a union nested inside it. */
function typesOf(schema: ChangeShape | ChangeUnion): string[] {
  if ('shape' in schema) return [schema.shape.type.value]
  return schema.options.flatMap(typesOf)
}

const changeTypes = [...new Set(typesOf(DocumentChangeSchema))]
const workflowOnlyTypes = [...new Set(typesOf(WorkflowChangeSchema))].filter(
  (type) => !changeTypes.includes(type),
)

function publicMethods(service: { prototype: object }): string[] {
  return Object.getOwnPropertyNames(service.prototype).filter(
    (name) => name !== 'constructor',
  )
}

const SERVICES: ReadonlyArray<
  [string, { prototype: object }, Readonly<Record<string, Coverage>>]
> = [
  ['DocumentService', DocumentService, DOCUMENT_COMMANDS],
  ['SourceService', SourceService, SOURCE_COMMANDS],
  ['ResultService', ResultService, RESULT_COMMANDS],
  ['JobService', JobService, JOB_COMMANDS],
  ['WorkflowService', WorkflowService, WORKFLOW_COMMANDS],
  ['KeybindingService', KeybindingService, KEYBINDING_COMMANDS],
  ['RenderService', RenderService, RENDER_COMMANDS],
  ['DocumentBundleService', DocumentBundleService, BUNDLE_COMMANDS],
]

const registered = COMMANDS.map(({ name }) => name)

function commandsIn(coverage: Coverage): string[] {
  return Array.isArray(coverage)
    ? (coverage as ReadonlyArray<{ name: string }>).map(({ name }) => name)
    : []
}

describe('the website and the command line have the same features', () => {
  it('has a command for every kind of change the editor can make to a pipeline', () => {
    expect(Object.keys(DOCUMENT_CHANGE_COMMANDS).sort()).toEqual(
      [...changeTypes].sort(),
    )
  })

  it('has a command for every kind of change only a workflow has', () => {
    expect(Object.keys(WORKFLOW_CHANGE_COMMANDS).sort()).toEqual(
      [...workflowOnlyTypes].sort(),
    )
  })

  it('only names commands that are registered', () => {
    const named = [
      ...Object.values(DOCUMENT_CHANGE_COMMANDS).flat(),
      ...Object.values(WORKFLOW_CHANGE_COMMANDS).flat(),
      ...SERVICES.flatMap(([, , table]) =>
        Object.values(table).flatMap(commandsIn),
      ),
    ].map((entry) => (typeof entry === 'string' ? entry : entry.name))
    expect(named.length).toBeGreaterThan(0)
    for (const name of named) expect(registered).toContain(name)
  })

  describe.each(SERVICES)('%s', (_name, service, table) => {
    it('lists every public method, so none is left without a command', () => {
      expect(Object.keys(table).sort()).toEqual(publicMethods(service).sort())
    })

    it('gives a reason for each method that has no command', () => {
      for (const [method, coverage] of Object.entries(table)) {
        if (Array.isArray(coverage)) {
          expect(coverage.length, `${method} has no command`).toBeGreaterThan(0)
          continue
        }
        const reason =
          'screenOnly' in coverage
            ? coverage.screenOnly
            : (coverage as { internal: string }).internal
        expect(reason.length, `${method} needs a reason`).toBeGreaterThan(0)
      }
    })
  })
})
