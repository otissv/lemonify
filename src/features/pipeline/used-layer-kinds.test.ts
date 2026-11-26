import { describe, expect, it } from 'vitest'

import {
  DOCUMENT_LAYER_KIND,
  LAYER_KINDS,
  WORKFLOW_LAYER_KIND,
  createDocumentLayerStep,
  createWorkflowLayerStep,
} from '@/features/pipeline/layer-kinds'
import { layerNames } from '@/features/pipeline/layer-names'
import { PipelineSchema } from '@/features/pipeline/pipeline'
import { pipelineOf } from '@/test/pipelines'

const NAMES = layerNames({
  documents: [{ id: 'd1', name: 'Badge' }],
  workflows: [{ id: 'w1', name: 'Brand' }],
  sources: [{ id: 's1', fileName: 'logo.png' }],
})
const IDS = new Map([
  ['d1', 'd2'],
  ['w1', 'w2'],
  ['s1', 's2'],
])

function lookup(images: Record<string, { path: string; contentHash: string }>) {
  return (id: string) => Promise.resolve(images[id])
}

describe('a document layer', () => {
  const kind = LAYER_KINDS[DOCUMENT_LAYER_KIND]
  const layer = createDocumentLayerStep('d1')

  it('is saved with the id of the document it draws, and nothing else', () => {
    expect(PipelineSchema.safeParse(pipelineOf(layer)).success).toBe(true)
    for (const extra of [{ documentId: '' }, { sourceId: 's1' }]) {
      expect(
        PipelineSchema.safeParse(pipelineOf({ ...layer, ...extra })).success,
      ).toBe(false)
    }
  })

  it('uses the document, owns no image and takes none, and is given new ids with the document', () => {
    expect(kind.title).toBe('Document layer')
    expect(kind.withImage).toBeUndefined()
    expect(kind.uses(layer)).toEqual({ kind: 'document', documentId: 'd1' })
    expect(kind.sourceIds(layer)).toEqual([])
    expect(kind.withUsedIds(layer, IDS)).toEqual({ ...layer, documentId: 'd2' })
  })

  it('shows the document’s name, or that it is gone', () => {
    expect(kind.display(layer, NAMES)).toEqual({
      text: 'Badge',
      problem: false,
    })
    expect(kind.display(createDocumentLayerStep('gone'), NAMES)).toEqual({
      text: 'Document not available',
      problem: true,
    })
  })

  it('plans to draw the document it uses', async () => {
    expect(await kind.plan(layer, lookup({}))).toEqual({
      state: 'used',
      item: { kind: 'document', documentId: 'd1' },
    })
  })
})

describe('a workflow layer', () => {
  const kind = LAYER_KINDS[WORKFLOW_LAYER_KIND]
  const layer = createWorkflowLayerStep('w1', 's1')
  const empty = createWorkflowLayerStep('w1')

  it('is saved with its workflow and, when it has one, the image for its input slot', () => {
    expect(PipelineSchema.safeParse(pipelineOf(layer, empty)).success).toBe(
      true,
    )
    expect(empty.sourceId).toBeUndefined()
    expect(
      PipelineSchema.safeParse(pipelineOf({ ...layer, workflowId: '' }))
        .success,
    ).toBe(false)
  })

  it('uses the workflow, owns its image, and is given new ids for both', () => {
    expect(kind.title).toBe('Workflow layer')
    expect(kind.uses(layer)).toEqual({
      kind: 'workflow',
      workflowId: 'w1',
      sourceId: 's1',
    })
    expect(kind.sourceIds(layer)).toEqual(['s1'])
    expect(kind.sourceIds(empty)).toEqual([])
    expect(kind.withSourceIds(layer, IDS)).toEqual({ ...layer, sourceId: 's2' })
    expect(kind.withUsedIds(layer, IDS)).toEqual({ ...layer, workflowId: 'w2' })
    expect(kind.withImage?.(layer, undefined)).toEqual({
      ...empty,
      id: layer.id,
    })
    expect(kind.withImage?.(empty, 's1')).toEqual({ ...layer, id: empty.id })
  })

  it('shows the workflow and its image, saying when either is gone', () => {
    expect(kind.display(layer, NAMES)).toEqual({
      text: 'Brand · logo.png',
      problem: false,
    })
    expect(kind.display(empty, NAMES)).toEqual({
      text: 'Brand · no input image',
      problem: false,
    })
    expect(kind.display(createWorkflowLayerStep('w1', 'gone'), NAMES)).toEqual({
      text: 'Brand · image not available',
      problem: true,
    })
    expect(kind.display(createWorkflowLayerStep('gone'), NAMES)).toEqual({
      text: 'Workflow not available',
      problem: true,
    })
  })

  it('plans to draw the workflow on its image, or reports the image gone', async () => {
    const images = lookup({ s1: { path: '/data/s1', contentHash: 'h1' } })
    expect(await kind.plan(layer, images)).toEqual({
      state: 'used',
      item: { kind: 'workflow', workflowId: 'w1', sourceId: 's1' },
    })
    expect(await kind.plan(empty, images)).toEqual({
      state: 'used',
      item: { kind: 'workflow', workflowId: 'w1' },
    })
    expect(await kind.plan(layer, lookup({}))).toEqual({ state: 'gone' })
  })
})
