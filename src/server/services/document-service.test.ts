import { beforeEach, describe, expect, it } from 'vitest'

import type { DocumentView } from '@/features/documents/document'
import type { DocumentChange } from '@/features/pipeline/document-change'
import { MAX_HISTORY_ENTRIES } from '@/features/pipeline/document-change'
import { createSharpStep } from '@/features/pipeline/pipeline'
import { createImageLayerStep } from '@/features/pipeline/layer-kinds'
import { MemoryDocumentDao } from '../dao/memory/document-dao'
import { MemorySourceDao } from '../dao/memory/source-dao'
import { MemoryStore } from '../dao/memory/store'
import { ConflictError, NotFoundError, ValidationError } from '../errors'
import { FixedClock, RecordingPublisher, SequenceIds } from '../testing/fakes'
import { DocumentService } from './document-service'
import type { DocumentCleanup } from './document-service'
import { pipelineOf } from '@/test/pipelines'

const ANN = { userId: 'ann', name: 'Ann' }
const BEA = { userId: 'bea', name: 'Bea' }

let store: MemoryStore
let sourceDao: MemorySourceDao
let cleanups: string[]
let clock: FixedClock
let service: DocumentService
let publisher: RecordingPublisher

async function addSource(
  id: string,
  ownerId = 'ann',
  fileName = 'cat.png',
): Promise<void> {
  await sourceDao.insert({
    id,
    ownerId,
    contentHash: `hash-${id}`,
    fileName,
    mediaType: 'image/png',
    bytes: 10,
    width: 4,
    height: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
  })
}

/** Adds a blur after the Open image step a new Document starts with. */
function addBlur(stepId: string, index = 1): DocumentChange {
  return {
    type: 'add-step',
    step: { ...createSharpStep('blur'), id: stepId },
    index,
  }
}

function blurIds(view: DocumentView): string[] {
  return view.pipeline.steps
    .filter((step) => step.kind === 'sharp')
    .map((step) => step.id)
}

const STEP_A = '00000000-0000-4000-8000-00000000000a'
const STEP_B = '00000000-0000-4000-8000-00000000000b'
const STEP_C = '00000000-0000-4000-8000-00000000000c'

beforeEach(async () => {
  store = new MemoryStore()
  sourceDao = new MemorySourceDao(store)
  cleanups = []
  clock = new FixedClock()
  const cleanup: DocumentCleanup = {
    onDocumentDeleted: async (_actor, id) => {
      cleanups.push(id)
    },
  }
  publisher = new RecordingPublisher()
  service = new DocumentService({
    documents: new MemoryDocumentDao(store),
    sources: sourceDao,
    clock,
    ids: new SequenceIds('doc'),
    cleanup,
    changes: publisher,
  })
  await addSource('src-1')
})

describe('create, list and get', () => {
  it('creates a Document whose Pipeline starts with its image as a layer, named after the image', async () => {
    const view = await service.create(ANN, 'src-1')
    expect(view.pipeline.steps).toEqual([
      expect.objectContaining({
        kind: 'image-layer',
        sourceId: 'src-1',
        enabled: true,
      }),
    ])
    expect(view).toMatchObject({
      id: 'doc-1',
      name: 'cat',
      revision: 0,
      canUndo: false,
      canRedo: false,
      source: { id: 'src-1', fileName: 'cat.png', width: 4, height: 3 },
      sources: [{ id: 'src-1' }],
    })
  })

  it('opens an image onto a canvas of its size, once: the canvas does not follow the image afterwards', async () => {
    const created = await service.create(ANN, 'src-1')
    expect(created.pipeline.canvas).toEqual({
      width: 4,
      height: 3,
      background: 'transparent',
    })

    const resized = await service.change(ANN, created.id, 0, {
      type: 'set-canvas',
      canvas: { width: 40, height: 30, background: '#112233' },
    })
    const replaced = await service.change(ANN, created.id, 1, {
      type: 'set-canvas',
      canvas: { width: 40, height: 30, background: '#112233' },
    })

    expect(resized.pipeline.canvas.width).toBe(40)
    expect(replaced.revision).toBe(1)
  })

  it('makes a blank Document on the canvas given, with no layers', async () => {
    const view = await service.createBlank(
      ANN,
      { width: 20, height: 10, background: '#FF8800' },
      '  Banner ',
    )

    expect(view).toMatchObject({
      name: 'Banner',
      revision: 0,
      source: null,
      sources: [],
      pipeline: {
        canvas: { width: 20, height: 10, background: '#ff8800' },
        steps: [],
      },
    })
    expect(await service.get(ANN, view.id)).toEqual(view)
  })

  it('refuses a blank Document with a bad canvas or name, and keeps it from other Users', async () => {
    const good = { width: 20, height: 10, background: 'transparent' }
    await expect(
      service.createBlank(ANN, { ...good, width: 0 }, 'A'),
    ).rejects.toThrow(ValidationError)
    await expect(
      service.createBlank(ANN, { ...good, background: 'red' }, 'A'),
    ).rejects.toThrow(ValidationError)
    await expect(
      service.createBlank(ANN, { ...good, width: 65535, height: 65535 }, 'A'),
    ).rejects.toThrow(ValidationError)
    await expect(service.createBlank(ANN, good, '  ')).rejects.toThrow(
      ValidationError,
    )
    const view = await service.createBlank(ANN, good, 'Mine')
    await expect(service.get(BEA, view.id)).rejects.toThrow(NotFoundError)
  })

  it('undoes a canvas change', async () => {
    const created = await service.createBlank(
      ANN,
      { width: 20, height: 10, background: 'transparent' },
      'Banner',
    )
    await service.change(ANN, created.id, 0, {
      type: 'set-canvas',
      canvas: { width: 5, height: 5, background: 'transparent' },
    })

    const undone = await service.undo(ANN, created.id, 1)

    expect(undone.pipeline.canvas.width).toBe(20)
  })

  it('takes a name, trimmed, and refuses an empty or very long one', async () => {
    expect((await service.create(ANN, 'src-1', '  Holiday  ')).name).toBe(
      'Holiday',
    )
    await expect(service.create(ANN, 'src-1', '   ')).rejects.toThrow(
      ValidationError,
    )
    await expect(service.create(ANN, 'src-1', 'x'.repeat(81))).rejects.toThrow(
      /80 characters/,
    )
  })

  it('refuses another User’s Source as if it did not exist', async () => {
    await expect(service.create(BEA, 'src-1')).rejects.toThrow(NotFoundError)
    await expect(service.create(ANN, 'nope')).rejects.toThrow(
      'That image does not exist.',
    )
  })

  it('lists only the User’s Documents, newest first, whatever changes after', async () => {
    const first = await service.create(ANN, 'src-1', 'First')
    clock.advance(1000)
    const second = await service.create(ANN, 'src-1', 'Second')
    clock.advance(1000)
    await service.rename(ANN, first.id, 'First again')
    await addSource('src-b', 'bea')
    await service.create(BEA, 'src-b')
    expect((await service.list(ANN)).map((d) => d.id)).toEqual([
      second.id,
      first.id,
    ])
    expect((await service.list(ANN))[1]).toMatchObject({
      name: 'First again',
      source: { id: 'src-1' },
    })
  })

  it('moves a Document to a place in the User’s list', async () => {
    const first = await service.create(ANN, 'src-1', 'First')
    const second = await service.create(ANN, 'src-1', 'Second')
    const third = await service.create(ANN, 'src-1', 'Third')

    await service.move(ANN, first.id, 0)
    expect((await service.list(ANN)).map((d) => d.id)).toEqual([
      first.id,
      third.id,
      second.id,
    ])
    await service.move(ANN, first.id, 2)
    expect((await service.list(ANN)).map((d) => d.id)).toEqual([
      third.id,
      second.id,
      first.id,
    ])
  })

  it('does not let a User move another User’s Document', async () => {
    const mine = await service.create(ANN, 'src-1')
    await addSource('src-b', 'bea')
    await service.create(BEA, 'src-b')

    await expect(service.move(BEA, mine.id, 0)).rejects.toThrow(NotFoundError)
    await expect(service.move(ANN, 'missing', 0)).rejects.toThrow(NotFoundError)
  })

  it('shows a Document only to its owner', async () => {
    const view = await service.create(ANN, 'src-1')
    await expect(service.get(BEA, view.id)).rejects.toThrow(NotFoundError)
    expect((await service.get(ANN, view.id)).id).toBe(view.id)
  })

  it('renames and refuses to rename someone else’s', async () => {
    const view = await service.create(ANN, 'src-1')
    expect((await service.rename(ANN, view.id, 'New')).name).toBe('New')
    await expect(service.rename(BEA, view.id, 'Mine')).rejects.toThrow(
      NotFoundError,
    )
    await expect(service.rename(ANN, view.id, '')).rejects.toThrow(
      ValidationError,
    )
  })
})

describe('change', () => {
  it('applies an edit, raising the revision and allowing undo', async () => {
    const created = await service.create(ANN, 'src-1')
    const changed = await service.change(ANN, created.id, 0, addBlur(STEP_A))
    expect(changed.revision).toBe(1)
    expect(changed.pipeline.steps).toHaveLength(2)
    expect(changed).toMatchObject({ canUndo: true, canRedo: false })
  })

  it('records nothing for a change that leaves the Pipeline as it was', async () => {
    const created = await service.create(ANN, 'src-1')
    await service.change(ANN, created.id, 0, addBlur(STEP_A))
    const same = await service.change(ANN, created.id, 1, {
      type: 'set-enabled',
      stepId: STEP_A,
      enabled: true,
    })
    expect(same.revision).toBe(1)
  })

  it('refuses a change made on an old revision', async () => {
    const created = await service.create(ANN, 'src-1')
    await service.change(ANN, created.id, 0, addBlur(STEP_A))
    await expect(
      service.change(ANN, created.id, 0, addBlur(STEP_B)),
    ).rejects.toThrow(ConflictError)
    await expect(
      service.change(ANN, created.id, 0, {
        type: 'set-enabled',
        stepId: STEP_A,
        enabled: true,
      }),
    ).rejects.toThrow(/changed somewhere else/)
  })

  it('refuses a change that does not make sense, in plain words', async () => {
    const created = await service.create(ANN, 'src-1')
    await expect(
      service.change(ANN, created.id, 0, {
        type: 'remove-step',
        stepId: STEP_A,
      }),
    ).rejects.toThrow(/no longer in the pipeline/)
  })

  it('refuses another User’s Document', async () => {
    const created = await service.create(ANN, 'src-1')
    await expect(
      service.change(BEA, created.id, 0, addBlur(STEP_A)),
    ).rejects.toThrow(NotFoundError)
  })

  it('links a second image to the Document, and refuses one the User does not own', async () => {
    await addSource('src-2')
    await addSource('src-bea', 'bea')
    const created = await service.create(ANN, 'src-1')
    const withOperand = createSharpStep('boolean', {
      operand: 'src-2',
      operator: 'and',
    })
    const changed = await service.change(ANN, created.id, 0, {
      type: 'add-step',
      step: withOperand,
      index: 1,
    })
    expect(await sourceDao.isReferenced('src-2')).toBe(true)
    expect(changed.revision).toBe(1)

    const stolen = createSharpStep('boolean', {
      operand: 'src-bea',
      operator: 'and',
    })
    await expect(
      service.change(ANN, created.id, 1, {
        type: 'add-step',
        step: stolen,
        index: 2,
      }),
    ).rejects.toThrow('An image used by this step does not exist.')
  })
})

describe('undo and redo', () => {
  it('walks back and forward through the changes', async () => {
    const created = await service.create(ANN, 'src-1')
    await service.change(ANN, created.id, 0, addBlur(STEP_A))
    await service.change(ANN, created.id, 1, addBlur(STEP_B, 2))

    const undone = await service.undo(ANN, created.id, 2)
    expect(blurIds(undone)).toEqual([STEP_A])
    expect(undone).toMatchObject({ canUndo: true, canRedo: true, revision: 3 })

    const undoneAgain = await service.undo(ANN, created.id, 3)
    expect(blurIds(undoneAgain)).toEqual([])
    expect(undoneAgain.canUndo).toBe(false)

    const redone = await service.redo(ANN, created.id, 4)
    expect(blurIds(redone)).toEqual([STEP_A])
    const redoneAgain = await service.redo(ANN, created.id, 5)
    expect(blurIds(redoneAgain)).toEqual([STEP_A, STEP_B])
    expect(redoneAgain.canRedo).toBe(false)
  })

  it('says so when there is nothing to undo or redo', async () => {
    const created = await service.create(ANN, 'src-1')
    await expect(service.undo(ANN, created.id, 0)).rejects.toThrow(
      'There is nothing to undo.',
    )
    await expect(service.redo(ANN, created.id, 0)).rejects.toThrow(
      'There is nothing to redo.',
    )
  })

  it('drops the undone changes when a new one is made', async () => {
    const created = await service.create(ANN, 'src-1')
    await service.change(ANN, created.id, 0, addBlur(STEP_A))
    await service.undo(ANN, created.id, 1)
    const changed = await service.change(ANN, created.id, 2, addBlur(STEP_C))
    expect(blurIds(changed)).toEqual([STEP_C])
    expect(changed.canRedo).toBe(false)
  })

  it('refuses a stale revision and another User', async () => {
    const created = await service.create(ANN, 'src-1')
    await service.change(ANN, created.id, 0, addBlur(STEP_A))
    await expect(service.undo(ANN, created.id, 0)).rejects.toThrow(
      ConflictError,
    )
    await expect(service.undo(BEA, created.id, 1)).rejects.toThrow(
      NotFoundError,
    )
  })

  it('keeps operand links in step with the Pipeline across undo', async () => {
    await addSource('src-2')
    const created = await service.create(ANN, 'src-1')
    const step = createSharpStep('boolean', {
      operand: 'src-2',
      operator: 'and',
    })
    await service.change(ANN, created.id, 0, {
      type: 'add-step',
      step,
      index: 1,
    })
    expect(await sourceDao.isReferenced('src-2')).toBe(true)
    await service.undo(ANN, created.id, 1)
    expect(await sourceDao.isReferenced('src-2')).toBe(false)
    await service.redo(ANN, created.id, 2)
    expect(await sourceDao.isReferenced('src-2')).toBe(true)
  })

  it('keeps only the newest changes for undo', async () => {
    const created = await service.create(ANN, 'src-1')
    let revision = 0
    for (let i = 0; i < MAX_HISTORY_ENTRIES + 3; i += 1) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
      const view = await service.change(
        ANN,
        created.id,
        revision,
        addBlur(id, i + 1),
      )
      revision = view.revision
    }
    let undone = 0
    for (;;) {
      const view = await service.get(ANN, created.id)
      if (!view.canUndo) break
      await service.undo(ANN, created.id, view.revision)
      undone += 1
    }
    expect(undone).toBe(MAX_HISTORY_ENTRIES)
  })
})

describe('delete', () => {
  it('cleans up what belongs to the Document, then deletes it', async () => {
    const created = await service.create(ANN, 'src-1')
    await service.delete(ANN, created.id)
    expect(cleanups).toEqual([created.id])
    await expect(service.get(ANN, created.id)).rejects.toThrow(NotFoundError)
  })

  it('refuses someone else’s Document and cleans up nothing', async () => {
    const created = await service.create(ANN, 'src-1')
    await expect(service.delete(BEA, created.id)).rejects.toThrow(NotFoundError)
    expect(cleanups).toEqual([])
  })
})

describe('layers', () => {
  it('lists the images the layers use, the first layer’s being the document image', async () => {
    await addSource('src-2', 'ann', 'mask.png')
    const created = await service.create(ANN, 'src-1')
    const layered = await service.change(ANN, created.id, 0, {
      type: 'add-step',
      step: createImageLayerStep('src-2'),
      index: 1,
    })

    expect(layered.sources.map(({ id }) => id)).toEqual(['src-1', 'src-2'])
    expect(layered.source?.id).toBe('src-1')
    expect(await sourceDao.isReferenced('src-2')).toBe(true)
  })

  it('links the image of a layer, and unlinks it when the layer goes', async () => {
    await addSource('src-2')
    const created = await service.create(ANN, 'src-1')
    const layer = createImageLayerStep('src-2')
    await service.change(ANN, created.id, 0, {
      type: 'add-step',
      step: layer,
      index: 1,
    })
    await service.change(ANN, created.id, 1, {
      type: 'remove-step',
      stepId: layer.id,
    })

    expect(await sourceDao.isReferenced('src-2')).toBe(false)
    expect(await sourceDao.isReferenced('src-1')).toBe(true)
  })

  it('refuses a layer whose image is another User’s', async () => {
    await addSource('src-b', 'bea')
    const created = await service.create(ANN, 'src-1')

    await expect(
      service.change(ANN, created.id, 0, {
        type: 'add-step',
        step: createImageLayerStep('src-b'),
        index: 1,
      }),
    ).rejects.toThrow(NotFoundError)
  })

  it('replaces the image of a layer in place, and refuses another User’s image', async () => {
    await addSource('src-2')
    await addSource('src-b', 'bea')
    const created = await service.create(ANN, 'src-1')
    const [open] = created.pipeline.steps
    if (open === undefined) throw new Error('no step')

    const changed = await service.change(ANN, created.id, 0, {
      type: 'set-image',
      stepId: open.id,
      sourceId: 'src-2',
    })
    expect(changed.source?.id).toBe('src-2')
    await expect(
      service.change(ANN, created.id, 1, {
        type: 'set-image',
        stepId: open.id,
        sourceId: 'src-b',
      }),
    ).rejects.toThrow(NotFoundError)
  })

  it('makes the next layer the document image when the first is hidden or removed', async () => {
    await addSource('src-2', 'ann', 'mask.png')
    const created = await service.create(ANN, 'src-1')
    const [first] = created.pipeline.steps
    if (first === undefined) throw new Error('no step')
    const layered = await service.change(ANN, created.id, 0, {
      type: 'add-step',
      step: createImageLayerStep('src-2'),
      index: 1,
    })

    const hidden = await service.change(ANN, created.id, 1, {
      type: 'set-enabled',
      stepId: first.id,
      enabled: false,
    })
    const removed = await service.change(ANN, created.id, 2, {
      type: 'remove-step',
      stepId: first.id,
    })

    expect(layered.source?.id).toBe('src-1')
    expect(hidden.source?.id).toBe('src-2')
    expect(removed.source?.id).toBe('src-2')
    expect((await service.list(ANN))[0]?.source?.id).toBe('src-2')
    expect(await sourceDao.isReferenced('src-1')).toBe(false)
  })

  it('holds an empty image layer, which is not the document image and uses no image', async () => {
    const created = await service.create(ANN, 'src-1')
    const empty = createImageLayerStep()

    const added = await service.change(ANN, created.id, 0, {
      type: 'add-step',
      step: empty,
      index: 0,
    })

    expect(added.pipeline.steps[0]).toMatchObject({ id: empty.id })
    expect(added.source?.id).toBe('src-1')
    expect(added.sources.map(({ id }) => id)).toEqual(['src-1'])
  })

  it('has no document image while its only layer is empty, and has one once it is filled', async () => {
    const created = await service.createBlank(
      ANN,
      { width: 4, height: 3, background: 'transparent' },
      'Blank',
    )
    const empty = createImageLayerStep()
    await service.change(ANN, created.id, 0, {
      type: 'add-step',
      step: empty,
      index: 0,
    })

    const filled = await service.change(ANN, created.id, 1, {
      type: 'set-image',
      stepId: empty.id,
      sourceId: 'src-1',
    })
    const cleared = await service.change(ANN, created.id, 2, {
      type: 'set-image',
      stepId: empty.id,
      sourceId: null,
    })

    expect(filled.source?.id).toBe('src-1')
    expect(cleared.source).toBeNull()
    expect(cleared.pipeline.steps[0]).not.toHaveProperty('sourceId')
    expect(await sourceDao.isReferenced('src-1')).toBe(false)
  })

  it('refuses to fill a layer with another User’s image', async () => {
    await addSource('src-b', 'bea')
    const created = await service.createBlank(
      ANN,
      { width: 4, height: 3, background: 'transparent' },
      'Blank',
    )
    const empty = createImageLayerStep()
    await service.change(ANN, created.id, 0, {
      type: 'add-step',
      step: empty,
      index: 0,
    })

    await expect(
      service.change(ANN, created.id, 1, {
        type: 'set-image',
        stepId: empty.id,
        sourceId: 'src-b',
      }),
    ).rejects.toThrow(NotFoundError)
  })

  it('refuses to give an image to a step that is not a layer', async () => {
    const created = await service.create(ANN, 'src-1')
    const blur = createSharpStep('blur')
    await service.change(ANN, created.id, 0, {
      type: 'add-step',
      step: blur,
      index: 1,
    })

    await expect(
      service.change(ANN, created.id, 1, {
        type: 'set-image',
        stepId: blur.id,
        sourceId: 'src-1',
      }),
    ).rejects.toThrow(ValidationError)
  })

  it('has no document image when no layer is left', async () => {
    const created = await service.create(ANN, 'src-1')
    const [first] = created.pipeline.steps
    if (first === undefined) throw new Error('no step')

    const emptied = await service.change(ANN, created.id, 0, {
      type: 'remove-step',
      stepId: first.id,
    })

    expect(emptied.source).toBeNull()
    expect(emptied.sources).toEqual([])
    expect((await service.list(ANN))[0]?.source).toBeNull()
  })
})

describe('telling the person’s tabs', () => {
  it('says the list changed when a document is made', async () => {
    await service.create(ANN, 'src-1')

    expect(publisher.eventsFor('ann')).toEqual([{ type: 'documents.changed' }])
  })

  it('says the list changed when a document is made from a pipeline', async () => {
    await service.createFromPipeline(
      ANN,
      'Made',
      pipelineOf(createImageLayerStep('src-1')),
    )

    expect(publisher.eventsFor('ann')).toEqual([{ type: 'documents.changed' }])
  })

  it('says the document and the list changed when it is renamed', async () => {
    const view = await service.create(ANN, 'src-1')
    publisher.clear()
    clock.advance(1000)

    const renamed = await service.rename(ANN, view.id, 'New name')

    expect(publisher.eventsFor('ann')).toEqual([
      {
        type: 'document.updated',
        documentId: view.id,
        revision: renamed.revision,
        updatedAt: renamed.updatedAt,
      },
      { type: 'documents.changed' },
    ])
  })

  it('says the list changed when a document is moved', async () => {
    const view = await service.create(ANN, 'src-1')
    publisher.clear()

    await service.move(ANN, view.id, 0)

    expect(publisher.eventsFor('ann')).toEqual([{ type: 'documents.changed' }])
  })

  it('says the document is gone, and the list changed, when it is deleted', async () => {
    const view = await service.create(ANN, 'src-1')
    publisher.clear()

    await service.delete(ANN, view.id)

    expect(publisher.eventsFor('ann')).toEqual([
      { type: 'document.deleted', documentId: view.id },
      { type: 'documents.changed' },
    ])
  })

  it('says the document is at its new revision after an edit, an undo and a redo', async () => {
    const view = await service.create(ANN, 'src-1')
    publisher.clear()
    clock.advance(1000)

    const edited = await service.change(ANN, view.id, 0, addBlur(STEP_A))
    const undone = await service.undo(ANN, view.id, edited.revision)
    const redone = await service.redo(ANN, view.id, undone.revision)

    expect(publisher.eventsFor('ann')).toEqual(
      [edited, undone, redone].map((after) => ({
        type: 'document.updated',
        documentId: view.id,
        revision: after.revision,
        updatedAt: after.updatedAt,
      })),
    )
  })

  it('also says the list changed when an edit changes the image the document shows', async () => {
    await addSource('src-2')
    const view = await service.create(ANN, 'src-1')
    publisher.clear()

    await service.change(ANN, view.id, 0, {
      type: 'set-image',
      stepId: view.pipeline.steps[0]?.id ?? '',
      sourceId: 'src-2',
    })

    expect(publisher.eventsFor('ann').map((event) => event.type)).toEqual([
      'document.updated',
      'documents.changed',
    ])
  })

  it('says nothing when an edit changes nothing', async () => {
    const view = await service.create(ANN, 'src-1')
    const edited = await service.change(ANN, view.id, 0, addBlur(STEP_A))
    publisher.clear()

    await service.change(ANN, view.id, edited.revision, {
      type: 'set-enabled',
      stepId: STEP_A,
      enabled: true,
    })

    expect(publisher.sent).toEqual([])
  })

  it('says nothing when the change is refused', async () => {
    const view = await service.create(ANN, 'src-1')
    publisher.clear()

    await expect(
      service.change(ANN, view.id, 5, addBlur(STEP_A)),
    ).rejects.toThrow(ConflictError)
    await expect(service.undo(ANN, view.id, 0)).rejects.toThrow(ValidationError)
    await expect(service.rename(ANN, view.id, '  ')).rejects.toThrow(
      ValidationError,
    )
    await expect(service.delete(BEA, view.id)).rejects.toThrow(NotFoundError)

    expect(publisher.sent).toEqual([])
  })

  it('tells only the owner', async () => {
    await addSource('src-b', 'bea')
    await service.create(BEA, 'src-b')

    expect(publisher.eventsFor('ann')).toEqual([])
    expect(publisher.eventsFor('bea')).toEqual([{ type: 'documents.changed' }])
  })
})
