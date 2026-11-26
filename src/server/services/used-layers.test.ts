import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { canvasOfSize } from '@/features/pipeline/canvas'
import {
  createDocumentLayerStep,
  createWorkflowLayerStep,
} from '@/features/pipeline/layer-kinds'
import {
  createEmbeddedDocumentStep,
  createGroupStep,
  createPipeline,
  createSharpStep,
} from '@/features/pipeline/pipeline'
import type { PipelineStep } from '@/features/pipeline/pipeline'
import { CanvasSize, createWorkflow } from '@/features/workflows/workflow'

import { ConflictError, NotFoundError, ValidationError } from '../errors.ts'
import { createTestApp } from '../testing/test-app.ts'
import type { TestApp } from '../testing/test-app.ts'
import type { Actor } from '../domain/actor.ts'

const CANVAS = canvasOfSize(20, 10)

let t: TestApp

beforeEach(async () => {
  t = await createTestApp()
})

afterEach(async () => {
  await t.close()
})

function document(name: string, steps: PipelineStep[] = [], actor?: Actor) {
  return t.app.documents.createFromPipeline(
    actor ?? t.ann,
    name,
    createPipeline(CANVAS, steps),
  )
}

async function workflow(name: string, steps: PipelineStep[] = []) {
  const { pipeline, output } = createWorkflow('x', CANVAS)
  return t.app.workflows.create(t.ann, name, {
    pipeline: createPipeline(CANVAS, [...pipeline.steps, ...steps]),
    canvasSize: CanvasSize.Fixed,
    inputs: [],
    output,
  })
}

async function add(documentId: string, step: PipelineStep) {
  const current = await t.app.documents.get(t.ann, documentId)
  return t.app.documents.change(t.ann, documentId, current.revision, {
    type: 'add-step',
    step,
    index: current.pipeline.steps.length,
  })
}

describe('a document layer', () => {
  it('uses another of the User’s documents, and a group may hold it', async () => {
    const used = await document('Badge', [createSharpStep('flip')])
    const holder = await document('Poster')

    const changed = await add(
      holder.id,
      createGroupStep([createDocumentLayerStep(used.id)]),
    )

    expect(changed.pipeline.steps[0]).toMatchObject({
      kind: 'group',
      steps: [{ kind: 'document-layer', documentId: used.id }],
    })
  })

  it('refuses another User’s document, and one that does not exist', async () => {
    const holder = await document('Poster')
    const foreign = await document('Theirs', [], t.bob)

    await expect(
      add(holder.id, createDocumentLayerStep(foreign.id)),
    ).rejects.toThrow(NotFoundError)
    await expect(
      add(holder.id, createDocumentLayerStep(crypto.randomUUID())),
    ).rejects.toThrow(NotFoundError)
  })

  it('refuses to lead back to the document that holds it, at any depth', async () => {
    const a = await document('A')
    const b = await document('B', [createDocumentLayerStep(a.id)])

    await expect(add(a.id, createDocumentLayerStep(a.id))).rejects.toThrow(
      /cannot use the document or workflow that holds it/,
    )
    await expect(add(a.id, createDocumentLayerStep(b.id))).rejects.toThrow(
      ValidationError,
    )
  })

  it('keeps the whole tree within 8 levels, counting the documents layers use', async () => {
    let inner = await document('Level 0')
    for (let level = 1; level < 8; level += 1) {
      inner = await document(`Level ${level}`, [
        createDocumentLayerStep(inner.id),
      ])
    }
    const holder = await document('Top')

    await expect(
      add(
        holder.id,
        createEmbeddedDocumentStep([createDocumentLayerStep(inner.id)]),
      ),
    ).rejects.toThrow(/at most 8 deep/)
    await expect(
      add(holder.id, createDocumentLayerStep(inner.id)),
    ).resolves.toBeDefined()
  })
})

describe('a workflow layer', () => {
  it('uses one of the User’s workflows, in a document or another workflow, never itself', async () => {
    const used = await workflow('Brand', [createSharpStep('flip')])
    const holder = await document('Poster')
    await expect(
      add(holder.id, createWorkflowLayerStep(used.id)),
    ).resolves.toBeDefined()

    const outer = await workflow('Outer', [createWorkflowLayerStep(used.id)])
    expect(outer.pipeline.steps.at(-1)).toMatchObject({
      kind: 'workflow-layer',
    })
    await expect(
      t.app.workflows.change(t.ann, used.id, used.revision, {
        type: 'add-step',
        step: createWorkflowLayerStep(outer.id),
        index: 1,
      }),
    ).rejects.toThrow(ValidationError)
  })
})

describe('deleting something a layer uses', () => {
  it('is refused, naming what uses it, until the layer is gone', async () => {
    const used = await document('Badge')
    const flow = await workflow('Brand')
    const holder = await document('Poster')
    const changed = await add(holder.id, createDocumentLayerStep(used.id))
    await add(holder.id, createWorkflowLayerStep(flow.id))

    await expect(t.app.documents.delete(t.ann, used.id)).rejects.toThrow(
      ConflictError,
    )
    await expect(t.app.documents.delete(t.ann, used.id)).rejects.toThrow(
      /the document "Poster"/,
    )
    await expect(t.app.workflows.delete(t.ann, flow.id)).rejects.toThrow(
      /the document "Poster"/,
    )

    const layerId = changed.pipeline.steps[0]?.id ?? ''
    const current = await t.app.documents.get(t.ann, holder.id)
    await t.app.documents.change(t.ann, holder.id, current.revision, {
      type: 'remove-step',
      stepId: layerId,
    })
    await expect(
      t.app.documents.delete(t.ann, used.id),
    ).resolves.toBeUndefined()
  })
})

describe('converting a layer to an embedded document layer', () => {
  it('makes a copy of the used document in the layer’s place, which undo takes back', async () => {
    const used = await document('Badge', [createSharpStep('flip')])
    const holder = await document('Poster')
    const layer = { ...createDocumentLayerStep(used.id), opacity: 30 }
    const added = await add(holder.id, layer)

    const step = await t.app.createFrom.layerAsEmbedded(
      t.ann,
      { kind: 'document', id: holder.id },
      layer.id,
    )
    expect(step).toMatchObject({
      id: layer.id,
      kind: 'embedded-document',
      name: 'Badge',
      opacity: 30,
      steps: [{ kind: 'sharp', op: 'flip' }],
    })
    expect(step.steps[0]?.id).not.toBe(used.pipeline.steps[0]?.id)

    const converted = await t.app.documents.change(
      t.ann,
      holder.id,
      added.revision,
      { type: 'convert-step', step },
    )
    expect(converted.pipeline.steps[0]?.kind).toBe('embedded-document')
    const undone = await t.app.documents.undo(
      t.ann,
      holder.id,
      converted.revision,
    )
    expect(undone.pipeline.steps[0]).toEqual(layer)
  })

  it('copies a used workflow with the layer’s image in its input slot, in a workflow too', async () => {
    const flow = await workflow('Brand', [createSharpStep('flip')])
    const source = await t.uploadImage(t.ann)
    const layer = createWorkflowLayerStep(flow.id, source.id)
    const outer = await workflow('Outer', [layer])

    const step = await t.app.createFrom.layerAsEmbedded(
      t.ann,
      { kind: 'workflow', id: outer.id },
      layer.id,
    )

    expect(step).toMatchObject({ id: layer.id, name: 'Brand' })
    expect(step.steps[0]).toMatchObject({
      kind: 'image-layer',
      sourceId: source.id,
    })
  })

  it('refuses a step that is not a document or workflow layer', async () => {
    const holder = await document('Poster', [createSharpStep('flip')])
    const stepId = holder.pipeline.steps[0]?.id ?? ''

    await expect(
      t.app.createFrom.layerAsEmbedded(
        t.ann,
        { kind: 'document', id: holder.id },
        stepId,
      ),
    ).rejects.toThrow(ValidationError)
  })
})

describe('making a new item from a layer that uses another', () => {
  it('makes a workflow from the document a document layer uses, as if it were opened', async () => {
    const used = await document('Badge', [createSharpStep('flip')])
    const layer = createDocumentLayerStep(used.id)
    const holder = await document('Poster', [layer])

    const made = await t.app.createFrom.workflowFromDocument(t.ann, holder.id, {
      images: 'keep',
      stepId: layer.id,
    })

    expect(made.name).toBe('Badge')
    expect(made.pipeline.canvas).toEqual(CANVAS)
    expect(made.pipeline.steps).toMatchObject([
      { kind: 'image-layer' },
      { kind: 'sharp', op: 'flip' },
    ])
  })

  it('makes a document from the workflow a workflow layer uses, with the layer’s image as its input', async () => {
    const source = await t.uploadImage(t.ann)
    const flow = await workflow('Brand', [createSharpStep('flip')])
    const layer = createWorkflowLayerStep(flow.id, source.id)
    const outer = await workflow('Outer', [layer])

    const made = await t.app.createFrom.documentFromWorkflow(t.ann, outer.id, {
      stepId: layer.id,
    })

    expect(made.name).toBe('Brand')
    expect(made.pipeline.steps[0]).toMatchObject({
      kind: 'image-layer',
      sourceId: source.id,
    })
  })

  it('makes a document from a workflow with the input image given, or none', async () => {
    const source = await t.uploadImage(t.ann)
    const flow = await workflow('Brand', [createSharpStep('flip')])

    const filled = await t.app.createFrom.documentFromWorkflow(t.ann, flow.id, {
      inputImage: source.id,
    })
    const empty = await t.app.createFrom.documentFromWorkflow(t.ann, flow.id, {
      inputImage: null,
    })

    expect(filled.pipeline.steps[0]).toMatchObject({ sourceId: source.id })
    expect(empty.pipeline.steps[0]).not.toHaveProperty('sourceId')
    await expect(
      t.app.createFrom.documentFromWorkflow(t.ann, flow.id, {
        inputImage: (await t.uploadImage(t.bob)).id,
      }),
    ).rejects.toThrow(NotFoundError)
  })

  it('refuses the other kind of new item from a layer', async () => {
    const flow = await workflow('Brand')
    const layer = createWorkflowLayerStep(flow.id)
    const holder = await document('Poster', [layer])

    await expect(
      t.app.createFrom.workflowFromDocument(t.ann, holder.id, {
        images: 'keep',
        stepId: layer.id,
      }),
    ).rejects.toThrow(/uses a workflow/)
  })
})

describe('a change to something layers use', () => {
  it('tells the User’s tabs that every document and workflow drawing it, at any depth, has another picture', async () => {
    const used = await document('Badge')
    const middle = await document('Card', [createDocumentLayerStep(used.id)])
    const top = await workflow('Print', [createDocumentLayerStep(middle.id)])
    t.changes.clear()

    await add(used.id, createSharpStep('flip'))

    const pictures = t.changes
      .eventsFor(t.ann.userId)
      .filter((event) => event.type === 'picture.changed')
    expect(pictures).toEqual(
      expect.arrayContaining([
        { type: 'picture.changed', itemId: middle.id },
        { type: 'picture.changed', itemId: top.id },
      ]),
    )
    expect(pictures).toHaveLength(2)
  })

  it('tells the tabs when a used workflow changes too', async () => {
    const flow = await workflow('Brand')
    const holder = await document('Poster')
    await add(holder.id, createWorkflowLayerStep(flow.id))
    t.changes.clear()

    await t.app.workflows.change(t.ann, flow.id, flow.revision, {
      type: 'add-step',
      step: createSharpStep('flip'),
      index: 1,
    })

    expect(t.changes.eventsFor(t.ann.userId)).toContainEqual({
      type: 'picture.changed',
      itemId: holder.id,
    })
  })
})
