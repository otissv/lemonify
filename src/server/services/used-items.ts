import { isLayerStep, layerKind } from '@/features/pipeline/layer-kinds'
import type { UsedItem } from '@/features/pipeline/layer-kinds'
import { isContainerStep, leafSteps } from '@/features/pipeline/pipeline'
import type { Pipeline, PipelineStep } from '@/features/pipeline/pipeline'
import { MAX_NESTING_DEPTH } from '@/features/pipeline/pipeline-limits'
import type { UsedSnapshot } from '@/features/workflows/used-snapshot'

import type { DocumentDao, DocumentRecord } from '../dao/document-dao.ts'
import type { WorkflowDao, WorkflowRecord } from '../dao/workflow-dao.ts'
import { ConflictError, NotFoundError, ValidationError } from '../errors.ts'
import type { ChangePublisher } from '../realtime/change-publisher.ts'

/** A document or a workflow, as something that holds layers or is used by one. */
export type ItemRef = { kind: 'document' | 'workflow'; id: string }

/** An item that uses another, with the name to tell a person. */
export type ItemUser = ItemRef & { name: string }

const MISSING = 'A layer uses a document or workflow that does not exist.'
const CIRCULAR =
  'A layer cannot use the document or workflow that holds it, at any depth.'
const TOO_DEEP = `Groups, embedded document layers and the documents and workflows layers use go at most ${MAX_NESTING_DEPTH} deep.`

export type UsedItemsDependencies = {
  documents: DocumentDao
  workflows: WorkflowDao
}

function refOf(item: UsedItem): ItemRef {
  return item.kind === 'document'
    ? { kind: 'document', id: item.documentId }
    : { kind: 'workflow', id: item.workflowId }
}

function keyOf(ref: ItemRef): string {
  return `${ref.kind}:${ref.id}`
}

/** Every item the layers of `steps` use directly, at any depth of groups and embedded document layers. */
export function usedRefs(steps: ReadonlyArray<PipelineStep>): ItemRef[] {
  const refs: ItemRef[] = []
  for (const step of leafSteps({ steps })) {
    if (!isLayerStep(step)) continue
    const used = layerKind(step).uses(step)
    if (used !== undefined) refs.push(refOf(used))
  }
  return refs
}

/**
 * The rules for layers that use other documents and workflows: they use only
 * the User's own, never lead back to the item that holds them, and keep the
 * whole tree within the depth limit. Also who uses an item, and the copy of
 * everything a pipeline uses that a run keeps.
 */
export class UsedItems {
  readonly #deps: UsedItemsDependencies

  constructor(deps: UsedItemsDependencies) {
    this.#deps = deps
  }

  /** The pipeline of a used item of the owner, or a NotFoundError. */
  async pipelineOf(ownerId: string, ref: ItemRef): Promise<Pipeline> {
    if (ref.kind === 'document') {
      const found = await this.#deps.documents.findById(ref.id)
      if (found === null || found.ownerId !== ownerId) {
        throw new NotFoundError(MISSING)
      }
      return found.pipeline
    }
    const found = await this.#deps.workflows.findById(ref.id)
    if (found === null || found.ownerId !== ownerId) {
      throw new NotFoundError(MISSING)
    }
    return found.definition.pipeline
  }

  /** Refuses a pipeline whose layers use what is not the owner's, lead back to `holder`, or go too deep in all. */
  async check(
    ownerId: string,
    holder: ItemRef,
    pipeline: Pipeline,
  ): Promise<void> {
    if (usedRefs(pipeline.steps).length === 0) return
    const depth = await this.#depth(ownerId, pipeline.steps, [keyOf(holder)])
    if (depth > MAX_NESTING_DEPTH) throw new ValidationError(TOO_DEEP)
  }

  /** How deep the steps go, counting each container and each used item as a level; refuses a path that comes back to an item on it. */
  async #depth(
    ownerId: string,
    steps: ReadonlyArray<PipelineStep>,
    path: ReadonlyArray<string>,
  ): Promise<number> {
    let deepest = 0
    for (const step of steps) {
      if (isContainerStep(step)) {
        deepest = Math.max(
          deepest,
          1 + (await this.#depth(ownerId, step.steps, path)),
        )
        continue
      }
      if (!isLayerStep(step)) continue
      const used = layerKind(step).uses(step)
      if (used === undefined) continue
      const ref = refOf(used)
      if (path.includes(keyOf(ref))) throw new ValidationError(CIRCULAR)
      if (path.length > MAX_NESTING_DEPTH) throw new ValidationError(TOO_DEEP)
      const inner = await this.pipelineOf(ownerId, ref)
      deepest = Math.max(
        deepest,
        1 + (await this.#depth(ownerId, inner.steps, [...path, keyOf(ref)])),
      )
    }
    return deepest
  }

  /** The owner's documents and workflows whose layers use `item` directly. */
  async usersOf(ownerId: string, item: ItemRef): Promise<ItemUser[]> {
    const users: ItemUser[] = []
    const wanted = keyOf(item)
    for (const document of await this.#deps.documents.listByOwner(ownerId)) {
      if (
        usedRefs(document.pipeline.steps).some((ref) => keyOf(ref) === wanted)
      ) {
        users.push({ kind: 'document', id: document.id, name: document.name })
      }
    }
    for (const workflow of await this.#deps.workflows.listByOwner(ownerId)) {
      const steps = workflow.definition.pipeline.steps
      if (usedRefs(steps).some((ref) => keyOf(ref) === wanted)) {
        users.push({ kind: 'workflow', id: workflow.id, name: workflow.name })
      }
    }
    return users
  }

  /** Refuses to delete an item that a layer uses, naming the documents and workflows that use it. */
  async requireUnused(ownerId: string, item: ItemRef): Promise<void> {
    const users = await this.usersOf(ownerId, item)
    if (users.length === 0) return
    const names = users.map(({ kind, name }) => `the ${kind} "${name}"`)
    throw new ConflictError(
      `It is used by ${names.join(', ')}. Remove those layers first.`,
    )
  }

  /** Every document and workflow of the owner that uses `item`, directly or through others: those whose picture changes when it does. */
  async dependentsOf(ownerId: string, item: ItemRef): Promise<ItemRef[]> {
    const found = new Map<string, ItemRef>()
    const queue: ItemRef[] = [item]
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      for (const user of await this.usersOf(ownerId, next)) {
        const key = keyOf(user)
        if (found.has(key) || key === keyOf(item)) continue
        found.set(key, { kind: user.kind, id: user.id })
        queue.push(user)
      }
    }
    return [...found.values()]
  }

  /**
   * Tells the owner's tabs that every item drawing `item`, at any depth, has
   * another picture now. Telling tabs is not part of a change, so a failure to
   * find them is dropped, as the publisher drops one it cannot deliver.
   */
  async announcePictureChanged(
    ownerId: string,
    item: ItemRef,
    changes: ChangePublisher,
  ): Promise<void> {
    let dependents: ItemRef[]
    try {
      dependents = await this.dependentsOf(ownerId, item)
    } catch {
      return
    }
    for (const dependent of dependents) {
      changes.publish(ownerId, {
        type: 'picture.changed',
        itemId: dependent.id,
      })
    }
  }

  /** Every document and workflow of the owner the pipeline uses, at any depth, each once: what a document file carries. */
  async tree(
    ownerId: string,
    pipeline: Pipeline,
  ): Promise<{ documents: DocumentRecord[]; workflows: WorkflowRecord[] }> {
    const documents = new Map<string, DocumentRecord>()
    const workflows = new Map<string, WorkflowRecord>()
    const queue = usedRefs(pipeline.steps)
    for (let ref = queue.shift(); ref !== undefined; ref = queue.shift()) {
      if (ref.kind === 'document') {
        if (documents.has(ref.id)) continue
        const found = await this.#deps.documents.findById(ref.id)
        if (found === null || found.ownerId !== ownerId) {
          throw new NotFoundError(MISSING)
        }
        documents.set(ref.id, found)
        queue.push(...usedRefs(found.pipeline.steps))
        continue
      }
      if (workflows.has(ref.id)) continue
      const found = await this.#deps.workflows.findById(ref.id)
      if (found === null || found.ownerId !== ownerId) {
        throw new NotFoundError(MISSING)
      }
      workflows.set(ref.id, found)
      queue.push(...usedRefs(found.definition.pipeline.steps))
    }
    return {
      documents: [...documents.values()],
      workflows: [...workflows.values()],
    }
  }

  /** A copy of every document and workflow the pipeline uses, at any depth, as it is now: what a run keeps. */
  async snapshot(ownerId: string, pipeline: Pipeline): Promise<UsedSnapshot> {
    const snapshot: UsedSnapshot = { documents: {}, workflows: {} }
    const queue = usedRefs(pipeline.steps)
    for (let ref = queue.shift(); ref !== undefined; ref = queue.shift()) {
      if (ref.kind === 'document') {
        if (Object.hasOwn(snapshot.documents, ref.id)) continue
        const used = await this.pipelineOf(ownerId, ref)
        snapshot.documents[ref.id] = used
        queue.push(...usedRefs(used.steps))
        continue
      }
      if (Object.hasOwn(snapshot.workflows, ref.id)) continue
      const found = await this.#deps.workflows.findById(ref.id)
      if (found === null || found.ownerId !== ownerId) {
        throw new NotFoundError(MISSING)
      }
      snapshot.workflows[ref.id] = found.definition
      queue.push(...usedRefs(found.definition.pipeline.steps))
    }
    return snapshot
  }
}
