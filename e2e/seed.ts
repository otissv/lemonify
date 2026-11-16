import { layerSettingsSchema } from '../src/features/pipeline/layer.ts'
import {
  createLayerStep,
  createSharpStep,
} from '../src/features/pipeline/pipeline.ts'
import type { PipelineStep } from '../src/features/pipeline/pipeline.ts'
import { stepBlendSchema } from '../src/features/pipeline/step-blend.ts'
import type { App } from '../src/server/composition.ts'
import type { Actor } from '../src/server/domain/actor.ts'
import type { JsonRecord, JsonValue, StepSpec, ToolCase } from './case-types.ts'
import { CASES } from './cases/index.ts'
import { makeImages } from './fixtures.ts'

/** Which document shows which case. */
export type Manifest = Record<string, string>

const REFERENCE_PREFIX = '@'

type SourceIds = Record<string, string>

function resolveReferences(value: JsonValue, sources: SourceIds): JsonValue {
  if (typeof value === 'string' && value.startsWith(REFERENCE_PREFIX)) {
    const id = sources[value.slice(REFERENCE_PREFIX.length)]
    if (id === undefined) throw new Error(`There is no image called ${value}.`)
    return id
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveReferences(item, sources))
  }
  if (value !== null && typeof value === 'object') {
    const resolved: JsonRecord = {}
    for (const [key, inner] of Object.entries(value)) {
      resolved[key] = resolveReferences(inner, sources)
    }
    return resolved
  }
  return value
}

function pipelineStep(spec: StepSpec, sources: SourceIds): PipelineStep {
  if (spec.kind === 'layer') {
    const sourceId = sources[spec.image]
    if (sourceId === undefined) throw new Error(`No image ${spec.image}.`)
    return {
      ...createLayerStep(sourceId),
      ...layerSettingsSchema.parse(spec.settings),
      enabled: spec.enabled,
    }
  }
  const options = resolveReferences(spec.options, sources) as JsonRecord
  const step = createSharpStep(spec.op, options)
  return {
    ...step,
    enabled: spec.enabled,
    ...(spec.blend ? { blend: stepBlendSchema.parse(spec.blend) } : {}),
  }
}

async function upload(
  app: App,
  actor: Actor,
  name: string,
  bytes: Buffer,
): Promise<string> {
  const body = (async function* () {
    yield new Uint8Array(bytes)
  })()
  const source = await app.sources.upload(actor, body, `${name}.png`)
  return source.id
}

async function buildDocument(
  app: App,
  actor: Actor,
  testCase: ToolCase,
  sources: SourceIds,
): Promise<string> {
  const baseId = sources[testCase.base]
  if (baseId === undefined) throw new Error(`No image ${testCase.base}.`)
  let document = await app.documents.create(actor, baseId, testCase.id)
  for (const spec of testCase.steps) {
    document = await app.documents.change(
      actor,
      document.id,
      document.revision,
      {
        type: 'add-step',
        step: pipelineStep(spec, sources),
        index: document.pipeline.steps.length,
      },
    )
  }
  return document.id
}

/** Uploads the pictures and builds one document for each case, for the signed-up person `userName`. */
export async function seedDocuments(
  app: App,
  userName: string,
): Promise<Manifest> {
  const actor = await app.users.resolveActor(userName)
  const images = await makeImages()
  const sources: SourceIds = {}
  for (const [name, bytes] of Object.entries(images)) {
    sources[name] = await upload(app, actor, name, bytes)
  }
  const manifest: Manifest = {}
  for (const testCase of CASES) {
    manifest[testCase.id] = await buildDocument(app, actor, testCase, sources)
  }
  return manifest
}
