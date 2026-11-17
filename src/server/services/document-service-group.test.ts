import { beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_LAYER_SETTINGS } from '@/features/pipeline/layer'
import {
  MAX_GROUP_STEPS,
  createGroupStep,
  createSharpStep,
} from '@/features/pipeline/pipeline'
import { createImageLayerStep } from '@/features/pipeline/layer-kinds'
import { MemoryDocumentDao } from '../dao/memory/document-dao'
import { MemorySourceDao } from '../dao/memory/source-dao'
import { MemoryStore } from '../dao/memory/store'
import { NotFoundError, ValidationError } from '../errors'
import { FixedClock, RecordingPublisher, SequenceIds } from '../testing/fakes'
import { DocumentService } from './document-service'

const ANN = { userId: 'ann', name: 'Ann' }
const BEA = { userId: 'bea', name: 'Bea' }

let sourceDao: MemorySourceDao
let service: DocumentService

async function addSource(id: string, ownerId = 'ann'): Promise<void> {
  await sourceDao.insert({
    id,
    ownerId,
    contentHash: `hash-${id}`,
    fileName: `${id}.png`,
    mediaType: 'image/png',
    bytes: 10,
    width: 4,
    height: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
  })
}

beforeEach(async () => {
  const store = new MemoryStore()
  sourceDao = new MemorySourceDao(store)
  service = new DocumentService({
    documents: new MemoryDocumentDao(store),
    sources: sourceDao,
    clock: new FixedClock(),
    ids: new SequenceIds('doc'),
    cleanup: { onDocumentDeleted: async () => undefined },
    changes: new RecordingPublisher(),
  })
  await addSource('src-1')
  await addSource('src-2')
  await addSource('src-bea', 'bea')
})

describe('groups through the document service', () => {
  it('groups steps, and undo and redo restore the group whole', async () => {
    const blur = createSharpStep('blur')
    const flip = createSharpStep('flip')
    const created = await service.create(ANN, 'src-1')
    await service.change(ANN, created.id, 0, {
      type: 'add-step',
      step: blur,
      index: 1,
    })
    await service.change(ANN, created.id, 1, {
      type: 'add-step',
      step: flip,
      index: 2,
    })
    const group = { ...createGroupStep([blur, flip], 'Look'), opacity: 70 }

    const grouped = await service.change(ANN, created.id, 2, {
      type: 'group-steps',
      group,
    })
    expect(grouped.pipeline.steps).toHaveLength(2)
    expect(grouped.pipeline.steps[1]).toMatchObject({
      kind: 'group',
      name: 'Look',
      opacity: 70,
    })

    const undone = await service.undo(ANN, created.id, grouped.revision)
    expect(undone.pipeline.steps.map(({ id }) => id)).toEqual([
      created.pipeline.steps[0]?.id,
      blur.id,
      flip.id,
    ])
    const redone = await service.redo(ANN, created.id, undone.revision)
    expect(redone.pipeline.steps[1]).toMatchObject({ id: group.id })
  })

  it('links the images of layers inside a group, and refuses one the User does not own', async () => {
    const created = await service.create(ANN, 'src-1')
    const own = createGroupStep([createImageLayerStep('src-2')])
    const changed = await service.change(ANN, created.id, 0, {
      type: 'add-step',
      step: own,
      index: 1,
    })
    expect(await sourceDao.isReferenced('src-2')).toBe(true)

    const stolen = createGroupStep([createImageLayerStep('src-bea')])
    await expect(
      service.change(ANN, created.id, changed.revision, {
        type: 'add-step',
        step: stolen,
        index: 2,
      }),
    ).rejects.toThrow(NotFoundError)
  })

  it('refuses another image set into a layer inside a group that is not the User’s', async () => {
    const layer = createImageLayerStep('src-2')
    const created = await service.create(ANN, 'src-1')
    const first = await service.change(ANN, created.id, 0, {
      type: 'add-step',
      step: createGroupStep([layer]),
      index: 1,
    })

    await expect(
      service.change(ANN, created.id, first.revision, {
        type: 'set-image',
        stepId: layer.id,
        sourceId: 'src-bea',
      }),
    ).rejects.toThrow(NotFoundError)
  })

  it('keeps another User out of the document’s groups', async () => {
    const created = await service.create(ANN, 'src-1')
    await expect(
      service.change(BEA, created.id, 0, {
        type: 'add-step',
        step: createGroupStep([]),
        index: 1,
      }),
    ).rejects.toThrow(NotFoundError)
  })

  it('refuses a group that holds too many steps, and a group inside a group', async () => {
    const created = await service.create(ANN, 'src-1')
    const many = Array.from({ length: MAX_GROUP_STEPS + 1 }, () =>
      createSharpStep('flip'),
    )
    await expect(
      service.change(ANN, created.id, 0, {
        type: 'add-step',
        step: createGroupStep(many),
        index: 1,
      }),
    ).rejects.toThrow()

    const outer = createGroupStep([])
    const first = await service.change(ANN, created.id, 0, {
      type: 'add-step',
      step: outer,
      index: 1,
    })
    await expect(
      service.change(ANN, created.id, first.revision, {
        type: 'add-step',
        step: createGroupStep([]),
        index: 0,
        groupId: outer.id,
      }),
    ).rejects.toThrow(ValidationError)
  })

  it('refuses a step whose id is already used inside a group', async () => {
    const blur = createSharpStep('blur')
    const created = await service.create(ANN, 'src-1')
    const first = await service.change(ANN, created.id, 0, {
      type: 'add-step',
      step: createGroupStep([blur]),
      index: 1,
    })

    await expect(
      service.change(ANN, created.id, first.revision, {
        type: 'add-step',
        step: blur,
        index: 1,
      }),
    ).rejects.toThrow(ValidationError)
  })

  it('makes a group a sub-document and places it, with undo', async () => {
    const group = createGroupStep([createSharpStep('flip')])
    const created = await service.create(ANN, 'src-1')
    const added = await service.change(ANN, created.id, 0, {
      type: 'add-step',
      step: group,
      index: 1,
    })
    const sub = await service.change(ANN, created.id, added.revision, {
      type: 'set-sub-document',
      stepId: group.id,
      subDocument: true,
    })
    const placed = await service.change(ANN, created.id, sub.revision, {
      type: 'set-layer',
      stepId: group.id,
      settings: { ...DEFAULT_LAYER_SETTINGS, opacity: 25 },
    })
    expect(placed.pipeline.steps[1]).toMatchObject({
      subDocument: true,
      opacity: 25,
    })

    const undone = await service.undo(ANN, created.id, placed.revision)
    expect(undone.pipeline.steps[1]).toMatchObject({ opacity: 100 })
  })
})
