import { beforeEach, describe, expect, it } from 'vitest'

import type { DocumentView } from '@/features/documents/document'
import type { DocumentChange } from '@/features/pipeline/document-change'
import { MAX_HISTORY_ENTRIES } from '@/features/pipeline/document-change'
import { createLayerStep, createSharpStep } from '@/features/pipeline/pipeline'
import { MemoryDocumentDao } from '../dao/memory/document-dao'
import { MemorySourceDao } from '../dao/memory/source-dao'
import { MemoryStore } from '../dao/memory/store'
import { ConflictError, NotFoundError, ValidationError } from '../errors'
import { FixedClock, SequenceIds } from '../testing/fakes'
import { DocumentService } from './document-service'
import type { DocumentCleanup } from './document-service'

const ANN = { userId: 'ann', name: 'Ann' }
const BEA = { userId: 'bea', name: 'Bea' }

let store: MemoryStore
let sourceDao: MemorySourceDao
let cleanups: string[]
let clock: FixedClock
let service: DocumentService

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
  service = new DocumentService({
    documents: new MemoryDocumentDao(store),
    sources: sourceDao,
    clock,
    ids: new SequenceIds('doc'),
    cleanup,
  })
  await addSource('src-1')
})

describe('create, list and get', () => {
  it('creates a Document whose Pipeline opens its image, named after the image', async () => {
    const view = await service.create(ANN, 'src-1')
    expect(view.pipeline.steps).toEqual([
      expect.objectContaining({
        kind: 'source',
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

  it('lists only the User’s Documents, most recently changed first', async () => {
    const first = await service.create(ANN, 'src-1', 'First')
    clock.advance(1000)
    const second = await service.create(ANN, 'src-1', 'Second')
    clock.advance(1000)
    await service.rename(ANN, first.id, 'First again')
    await addSource('src-b', 'bea')
    await service.create(BEA, 'src-b')
    expect((await service.list(ANN)).map((d) => d.id)).toEqual([
      first.id,
      second.id,
    ])
    expect((await service.list(ANN))[0]).toMatchObject({
      name: 'First again',
      source: { id: 'src-1' },
    })
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
  it('lists the images the document and its layers use, the first being the document image', async () => {
    await addSource('src-2', 'ann', 'mask.png')
    const created = await service.create(ANN, 'src-1')
    const layered = await service.change(ANN, created.id, 0, {
      type: 'add-step',
      step: createLayerStep('src-2'),
      index: 1,
    })

    expect(layered.sources.map(({ id }) => id)).toEqual(['src-1', 'src-2'])
    expect(layered.source?.id).toBe('src-1')
    expect(await sourceDao.isReferenced('src-2')).toBe(true)
  })

  it('links the image of a layer, and unlinks it when the layer goes', async () => {
    await addSource('src-2')
    const created = await service.create(ANN, 'src-1')
    const layer = createLayerStep('src-2')
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
        step: createLayerStep('src-b'),
        index: 1,
      }),
    ).rejects.toThrow(NotFoundError)
  })

  it('replaces the document image in place, and refuses another User’s image', async () => {
    await addSource('src-2')
    await addSource('src-b', 'bea')
    const created = await service.create(ANN, 'src-1')
    const [open] = created.pipeline.steps
    if (open === undefined) throw new Error('no step')

    const changed = await service.change(ANN, created.id, 0, {
      type: 'set-source',
      stepId: open.id,
      sourceId: 'src-2',
    })
    expect(changed.source?.id).toBe('src-2')
    await expect(
      service.change(ANN, created.id, 1, {
        type: 'set-source',
        stepId: open.id,
        sourceId: 'src-b',
      }),
    ).rejects.toThrow(NotFoundError)
  })

  it('keeps the document image: it cannot be removed', async () => {
    const created = await service.create(ANN, 'src-1')
    const [open] = created.pipeline.steps
    if (open === undefined) throw new Error('no step')

    await expect(
      service.change(ANN, created.id, 0, {
        type: 'remove-step',
        stepId: open.id,
      }),
    ).rejects.toThrow(ValidationError)
  })
})
