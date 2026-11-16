import { randomUUID } from 'node:crypto'

import type { Knex } from 'knex'

import type { Migration } from './index.ts'

type Step = Record<string, unknown>
type DocumentRow = { id: string; pipeline: string }

const CARRIED_BLENDS: ReadonlySet<string> = new Set([
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
])
const BLEND_SPELLINGS: ReadonlyMap<string, string> = new Map([
  ['color-dodge', 'colour-dodge'],
  ['colour-dodge', 'colour-dodge'],
  ['color-burn', 'colour-burn'],
  ['colour-burn', 'colour-burn'],
])
const ANCHORS: ReadonlySet<string> = new Set([
  'northwest',
  'north',
  'northeast',
  'west',
  'centre',
  'east',
  'southwest',
  'south',
  'southeast',
])
const GRAVITY_SPELLINGS: ReadonlyMap<string, string> = new Map([
  ['center', 'centre'],
  ['top', 'north'],
  ['bottom', 'south'],
  ['left', 'west'],
  ['right', 'east'],
])

function isRecord(value: unknown): value is Step {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function whole(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : 0
}

function layerStep(id: string, sourceId: string, enabled: boolean): Step {
  return {
    id,
    kind: 'layer',
    sourceId,
    enabled,
    opacity: 100,
    blend: 'normal',
    fit: 'inside',
    scale: 100,
    rotation: 0,
    anchor: 'centre',
    x: 0,
    y: 0,
  }
}

function blendOf(raw: unknown): string {
  const name = text(raw)
  if (name === undefined) return 'normal'
  if (CARRIED_BLENDS.has(name)) return name
  return BLEND_SPELLINGS.get(name) ?? 'normal'
}

/** One composite image as a layer: placed by its offsets when it has them, otherwise by its gravity. Composite pictures were never resized, so the layer keeps its pixels. */
function layerOfComposite(
  id: string,
  image: Step,
  sourceId: string,
  enabled: boolean,
): Step {
  const layer = layerStep(id, sourceId, enabled)
  layer.blend = blendOf(image.blend)
  layer.fit = 'original'
  if (image.top !== undefined || image.left !== undefined) {
    layer.anchor = 'northwest'
    layer.x = whole(image.left)
    layer.y = whole(image.top)
    return layer
  }
  const gravity = text(image.gravity)
  const anchor =
    gravity === undefined
      ? undefined
      : (GRAVITY_SPELLINGS.get(gravity) ?? gravity)
  layer.anchor = anchor !== undefined && ANCHORS.has(anchor) ? anchor : 'centre'
  return layer
}

function operandIds(step: Step): string[] {
  if (step.kind !== 'sharp' || !isRecord(step.options)) return []
  const { options } = step
  if (step.op === 'boolean') {
    const operand = text(options.operand)
    return operand === undefined ? [] : [operand]
  }
  if (step.op === 'joinChannel') {
    const { images } = options
    if (typeof images === 'string') return [images]
    return Array.isArray(images) ? images.filter((id) => text(id)) : []
  }
  return []
}

function compositeImages(step: Step): Step[] {
  if (!isRecord(step.options)) return []
  const { images } = step.options
  return Array.isArray(images) ? images.filter(isRecord) : []
}

function layersOfComposite(step: Step): Step[] {
  const enabled = step.enabled !== false
  const layers: Step[] = []
  for (const image of compositeImages(step)) {
    const sourceId = text(image.input)
    if (sourceId === undefined) continue
    const id = layers.length === 0 ? String(step.id) : randomUUID()
    layers.push(layerOfComposite(id, image, sourceId, enabled))
  }
  return layers
}

/** The pipeline as the layer model wants it: the document's image first, extra images as layers or gone, composites as layers. */
export function layeredSteps(documentId: string, steps: Step[]): Step[] {
  const base = steps.find((step) => step.kind === 'source')
  if (base === undefined) {
    throw new Error(
      `The document ${documentId} has no image, so it cannot become layers. Delete it, or open an image in it, and migrate again.`,
    )
  }
  const used = new Set(steps.flatMap(operandIds))
  const migrated: Step[] = [base]
  for (const step of steps) {
    if (step === base) continue
    if (step.kind === 'source') {
      const sourceId = text(step.sourceId)
      if (sourceId === undefined || used.has(sourceId)) continue
      migrated.push(
        layerStep(String(step.id), sourceId, step.enabled !== false),
      )
      continue
    }
    if (step.kind === 'sharp' && step.op === 'composite') {
      migrated.push(...layersOfComposite(step))
      continue
    }
    migrated.push(step)
  }
  return migrated
}

function usedSourceIds(steps: Step[]): string[] {
  const ids = new Set<string>()
  for (const step of steps) {
    if (step.kind === 'source' || step.kind === 'layer') {
      const id = text(step.sourceId)
      if (id !== undefined) ids.add(id)
    }
    for (const id of operandIds(step)) ids.add(id)
  }
  return [...ids]
}

async function relink(
  database: Knex,
  documentId: string,
  sourceIds: string[],
): Promise<void> {
  await database('document_operands')
    .where({ document_id: documentId })
    .delete()
  for (const sourceId of sourceIds) {
    await database('document_operands').insert({
      document_id: documentId,
      source_id: sourceId,
    })
  }
}

/**
 * Images become layers. The first image step stays as the document's image and
 * goes first; every other image step that nothing else uses becomes a layer;
 * one that only gave a boolean or join channel step its second image goes,
 * since those steps name their image themselves; each composite step becomes a
 * layer per image. Step positions move, so the old undo history is cleared.
 */
export const layers: Migration = {
  name: '20260101000500-layers',
  async up(database) {
    const rows: DocumentRow[] = await database('documents').select(
      'id',
      'pipeline',
    )
    for (const row of rows) {
      const pipeline: { steps: Step[] } = JSON.parse(row.pipeline)
      const steps = layeredSteps(row.id, pipeline.steps)
      await relink(database, row.id, usedSourceIds(steps))
      await database('history_entries').where({ document_id: row.id }).delete()
      await database('documents')
        .where({ id: row.id })
        .update({
          pipeline: JSON.stringify({ steps }),
          history_cursor: 0,
          revision: database.raw('revision + 1'),
        })
    }
  },
  async down() {
    throw new Error(
      'The layers migration cannot be undone: documents no longer keep images that only supplied a second image.',
    )
  },
}
