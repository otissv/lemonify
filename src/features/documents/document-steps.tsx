import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { useLayerNames } from '@/features/documents/item-names'
import {
  childSteps,
  findStep,
  isContainerStep,
  placementProblem,
} from '@/features/pipeline/pipeline'
import type {
  ContainerStep,
  LeafStep,
  PipelineStep,
} from '@/features/pipeline/pipeline'
import { overlayToolFor } from '@/features/overlay/overlay-tools'
import { StepViewPart } from '@/features/overlay/step-view'
import { thumbnailImageUrl } from '@/features/documents/image-urls'
import { useDocument } from '@/features/documents/use-document'
import { GroupRow } from '@/features/documents/group-row'
import { StepRow } from '@/features/documents/step-row'
import { UsedLayerMenu } from '@/features/documents/used-layer-menu'
import { isLayerStep, layerKind } from '@/features/pipeline/layer-kinds'
import type {
  SelectModifiers,
  StepPictureChoice,
} from '@/features/documents/step-row'
import { pickSteps } from '@/features/documents/step-selection'
import { setStepDrag } from '@/features/documents/step-drag'
import {
  deleteStep,
  reorderStep,
  setStepOn,
} from '@/features/pipeline/pipeline-actions'
import { pipelineStepTitle } from '@/features/pipeline/step-problems'
import { usePreview } from '@/features/pipeline/use-preview'
import { useStepThumbnails } from '@/features/pipeline/use-step-thumbnails'
import { Tool, useUiStore } from '@/store/ui-store'
import { usePipelineStore } from '@/store/pipeline-store'

/** Where a dragged step would land: at `index` among the steps of the container `parentId`, or of the top level. */
interface DropPlace {
  index: number
  parentId?: string
}

interface DocumentStepsProps {
  documentId: string
  name: string
}

/** The steps of one document, the last on top as in a layer panel, so the first layer is lowest. Groups and embedded document layers list their steps under them, indented at every depth, and can be folded. Select, pick several with ctrl or shift, switch off, delete, and reorder by dragging (into, out of and between containers too) or with the buttons. Dragging one onto another document in the sidebar copies it there. */
export function DocumentSteps({
  documentId,
  name,
}: DocumentStepsProps): React.JSX.Element {
  const navigate = useNavigate()
  useDocument(documentId)
  const preview = usePreview(documentId)
  const names = useLayerNames(preview?.document.sources)
  const selectedId = useUiStore((state) => state.selectedSteps[documentId])
  const marked = useUiStore((state) => state.markedSteps[documentId])
  const collapsedGroups = useUiStore((state) => state.collapsedGroups)
  const thumbnails = usePipelineStore((state) => state.thumbnails[documentId])
  const run = usePipelineStore((state) => state.aiRuns[documentId])
  const selectStep = useUiStore((state) => state.selectStep)
  const stepView = useUiStore((state) => state.stepViews[documentId])
  const setStepView = useUiStore((state) => state.setStepView)
  const markSteps = useUiStore((state) => state.markSteps)
  const setGroupCollapsed = useUiStore((state) => state.setGroupCollapsed)
  const setActiveTool = useUiStore((state) => state.setActiveTool)
  const [draggedId, setDraggedId] = useState<string | undefined>(undefined)
  const [overParentId, setOverParentId] = useState<string | undefined>(
    undefined,
  )
  useStepThumbnails(documentId, true)

  const steps = preview?.pipeline.steps ?? []
  if (steps.length === 0) {
    return (
      <p className="px-2 py-1 text-caption text-muted-foreground">
        No edits yet.
      </p>
    )
  }

  function siblingsOf(stepId: string): string[] {
    if (!preview) return []
    const parentId = findStep(preview.pipeline, stepId)?.parentId
    return (childSteps(preview.pipeline, parentId) ?? []).map(({ id }) => id)
  }

  function handleSelect(stepId: string, modifiers: SelectModifiers): void {
    const picked = pickSteps({
      siblings: siblingsOf(stepId),
      marked: marked ?? [],
      anchor: selectedId,
      clicked: stepId,
      modifiers,
    })
    selectStep(documentId, picked.includes(stepId) ? stepId : picked.at(-1))
    markSteps(documentId, picked)
    setActiveTool(Tool.Options)
    void navigate({ to: '/documents/$id', params: { id: documentId } })
  }

  function handleToggle(stepId: string, isOn: boolean): void {
    setStepOn(documentId, stepId, isOn)
  }

  function handleDelete(stepId: string): void {
    deleteStep(documentId, stepId)
  }

  function handleMove(stepId: string, index: number, parentId?: string): void {
    reorderStep(documentId, stepId, index, parentId)
  }

  function handleCollapse(groupId: string, collapsed: boolean): void {
    setGroupCollapsed(groupId, collapsed)
  }

  function handleDragStart(
    event: React.DragEvent<HTMLLIElement>,
    stepId: string,
  ): void {
    event.stopPropagation()
    event.dataTransfer.setData('text/plain', stepId)
    setStepDrag(event.dataTransfer, { documentId, stepId })
    event.dataTransfer.effectAllowed = 'copyMove'
    setDraggedId(stepId)
  }

  function canDrop(place: DropPlace): boolean {
    if (draggedId === undefined || !preview) return false
    const dragged = findStep(preview.pipeline, draggedId)
    if (dragged === undefined) return false
    return (
      placementProblem(preview.pipeline, dragged.step, place.parentId) ===
      undefined
    )
  }

  function handleDragOver(
    event: React.DragEvent<HTMLLIElement>,
    place: DropPlace,
  ): void {
    if (!canDrop(place)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setOverParentId(place.parentId)
  }

  function handleShow(stepId: string, part: StepViewPart): void {
    handleSelect(stepId, { toggle: false, range: false })
    setStepView(documentId, part)
  }

  function picturesOf(step: LeafStep): StepPictureChoice | undefined {
    if (overlayToolFor(step) === undefined) return undefined
    const before = thumbnails?.find(
      ({ stepId, before }) => stepId === step.id && before === true,
    )?.key
    return {
      tool:
        before === null || before === undefined
          ? undefined
          : thumbnailImageUrl(documentId, before),
      shown:
        selectedId === step.id ? (stepView ?? StepViewPart.Tool) : undefined,
      onShow: handleShow,
    }
  }

  function menuOf(step: LeafStep): React.ReactNode {
    if (!isLayerStep(step)) return undefined
    const item = layerKind(step).uses(step)
    if (item === undefined) return undefined
    return (
      <UsedLayerMenu
        itemId={documentId}
        stepId={step.id}
        label={pipelineStepTitle(step)}
        item={item}
        names={names}
      />
    )
  }

  function handleDrop(
    event: React.DragEvent<HTMLLIElement>,
    place: DropPlace,
  ): void {
    if (draggedId === undefined || !canDrop(place)) return
    event.preventDefault()
    event.stopPropagation()
    reorderStep(documentId, draggedId, place.index, place.parentId)
    setDraggedId(undefined)
    setOverParentId(undefined)
  }

  function handleDragEnd(): void {
    setDraggedId(undefined)
    setOverParentId(undefined)
  }

  function renderStep(
    step: LeafStep,
    position: number,
    siblings: ReadonlyArray<PipelineStep>,
    parent: ContainerStep | undefined,
  ): React.JSX.Element {
    const key = thumbnails?.find(
      ({ stepId, before }) => stepId === step.id && before !== true,
    )?.key
    const place: DropPlace = { index: position, parentId: parent?.id }
    return (
      <li
        key={step.id}
        draggable
        onDragStart={(event) => {
          handleDragStart(event, step.id)
        }}
        onDragOver={(event) => {
          handleDragOver(event, place)
        }}
        onDrop={(event) => {
          handleDrop(event, place)
        }}
        onDragEnd={handleDragEnd}
      >
        <StepRow
          documentId={documentId}
          step={step}
          parentId={parent?.id}
          marked={marked?.includes(step.id) ?? false}
          position={position}
          count={siblings.length}
          selected={selectedId === step.id}
          dragging={draggedId === step.id}
          thumbnail={
            key === null || key === undefined
              ? undefined
              : thumbnailImageUrl(documentId, key)
          }
          pictures={picturesOf(step)}
          names={names}
          menu={menuOf(step)}
          outOfDate={
            (preview?.pending.includes(step.id) ?? false) ||
            (preview?.waitingLayers.includes(step.id) ?? false)
          }
          skipped={
            preview?.problems.find(({ stepId }) => stepId === step.id)?.message
          }
          run={run}
          onSelect={handleSelect}
          onToggle={handleToggle}
          onDelete={handleDelete}
          onMove={handleMove}
        />
      </li>
    )
  }

  function renderContainer(
    container: ContainerStep,
    position: number,
    siblings: ReadonlyArray<PipelineStep>,
    parent: ContainerStep | undefined,
  ): React.JSX.Element {
    const collapsed = collapsedGroups[container.id] ?? false
    const key = thumbnails?.find(
      ({ stepId, before }) => stepId === container.id && before !== true,
    )?.key
    const inside: DropPlace = {
      index: container.steps.length,
      parentId: container.id,
    }
    return (
      <li
        key={container.id}
        draggable
        onDragStart={(event) => {
          handleDragStart(event, container.id)
        }}
        onDragOver={(event) => {
          handleDragOver(event, inside)
        }}
        onDrop={(event) => {
          handleDrop(event, inside)
        }}
        onDragEnd={handleDragEnd}
      >
        <GroupRow
          group={container}
          parentId={parent?.id}
          position={position}
          count={siblings.length}
          selected={selectedId === container.id}
          marked={marked?.includes(container.id) ?? false}
          collapsed={collapsed}
          dragging={draggedId === container.id}
          receiving={
            overParentId === container.id && draggedId !== container.id
          }
          thumbnail={
            key === null || key === undefined
              ? undefined
              : thumbnailImageUrl(documentId, key)
          }
          skipped={
            preview?.problems.find(({ stepId }) => stepId === container.id)
              ?.message
          }
          onSelect={handleSelect}
          onCollapse={handleCollapse}
          onToggle={handleToggle}
          onDelete={handleDelete}
          onMove={handleMove}
        />
        {!collapsed && renderList(container.steps, container)}
      </li>
    )
  }

  /** One list of steps, the last on top; a container's list is indented under it. */
  function renderList(
    list: ReadonlyArray<PipelineStep>,
    parent: ContainerStep | undefined,
  ): React.JSX.Element {
    return (
      <ul
        aria-label={
          parent === undefined
            ? `Steps of ${name}`
            : `Steps in ${pipelineStepTitle(parent)}`
        }
        className={
          parent === undefined
            ? 'flex flex-col gap-1'
            : 'mt-1 ml-4 flex flex-col gap-1'
        }
      >
        {[...list].reverse().map((step) => {
          const position = list.indexOf(step)
          return isContainerStep(step)
            ? renderContainer(step, position, list, parent)
            : renderStep(step, position, list, parent)
        })}
      </ul>
    )
  }

  return renderList(steps, undefined)
}
