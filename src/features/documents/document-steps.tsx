import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import type { SourceSummary } from '@/features/documents/document'
import { isLayerStep, layerKind } from '@/features/pipeline/layer-kinds'
import { PipelineStepKind, findStep } from '@/features/pipeline/pipeline'
import type {
  GroupStep,
  LeafStep,
  PipelineStep,
} from '@/features/pipeline/pipeline'
import { overlayToolFor } from '@/features/overlay/overlay-tools'
import { StepViewPart } from '@/features/overlay/step-view'
import { thumbnailImageUrl } from '@/features/documents/image-urls'
import { useDocument } from '@/features/documents/use-document'
import { GroupRow } from '@/features/documents/group-row'
import { StepRow } from '@/features/documents/step-row'
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

function sourceNameOf(
  step: PipelineStep,
  sources: ReadonlyArray<SourceSummary> | undefined,
): string | undefined {
  if (!isLayerStep(step)) return undefined
  const [imageId] = layerKind(step).sourceIds(step)
  return sources?.find(({ id }) => id === imageId)?.fileName
}

/** Where a dragged step would land: at `index` among the steps of `groupId`, or of the top level. */
interface DropPlace {
  index: number
  groupId?: string
}

interface DocumentStepsProps {
  documentId: string
  name: string
}

/** The steps of one document, the last on top as in a layer panel, so the first layer is lowest. Groups list their steps under them and can be folded. Select, pick several with ctrl or shift, switch off, delete, and reorder by dragging (into or out of a group too) or with the buttons. Dragging one onto another document in the sidebar copies it there. */
export function DocumentSteps({
  documentId,
  name,
}: DocumentStepsProps): React.JSX.Element {
  const navigate = useNavigate()
  useDocument(documentId)
  const preview = usePreview(documentId)
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
  const [overGroupId, setOverGroupId] = useState<string | undefined>(undefined)
  useStepThumbnails(documentId, true)

  const steps = preview?.pipeline.steps ?? []
  const topFirst = [...steps].reverse()
  if (steps.length === 0) {
    return (
      <p className="px-2 py-1 text-caption text-muted-foreground">
        No edits yet.
      </p>
    )
  }

  function siblingsOf(stepId: string): string[] {
    const found = preview ? findStep(preview.pipeline, stepId) : undefined
    if (found?.groupId === undefined) return steps.map(({ id }) => id)
    const group = steps.find(({ id }) => id === found.groupId)
    return group?.kind === PipelineStepKind.Group
      ? group.steps.map(({ id }) => id)
      : []
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

  function handleMove(stepId: string, index: number, groupId?: string): void {
    reorderStep(documentId, stepId, index, groupId)
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
    if (draggedId === undefined) return false
    const dragged = preview ? findStep(preview.pipeline, draggedId) : undefined
    if (dragged === undefined) return false
    return !(
      dragged.step.kind === PipelineStepKind.Group &&
      place.groupId !== undefined
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
    setOverGroupId(place.groupId)
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

  function handleDrop(
    event: React.DragEvent<HTMLLIElement>,
    place: DropPlace,
  ): void {
    if (draggedId === undefined || !canDrop(place)) return
    event.preventDefault()
    event.stopPropagation()
    reorderStep(documentId, draggedId, place.index, place.groupId)
    setDraggedId(undefined)
    setOverGroupId(undefined)
  }

  function handleDragEnd(): void {
    setDraggedId(undefined)
    setOverGroupId(undefined)
  }

  function renderStep(
    step: LeafStep,
    position: number,
    siblings: ReadonlyArray<PipelineStep>,
    group?: GroupStep,
  ): React.JSX.Element {
    const key = thumbnails?.find(
      ({ stepId, before }) => stepId === step.id && before !== true,
    )?.key
    const place: DropPlace = { index: position, groupId: group?.id }
    return (
      <li
        key={step.id}
        draggable
        className={group ? 'ml-4' : undefined}
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
          groupId={group?.id}
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
          sourceName={sourceNameOf(step, preview?.document.sources)}
          outOfDate={preview?.pending.includes(step.id) ?? false}
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

  function renderGroup(group: GroupStep, position: number): React.JSX.Element {
    const collapsed = collapsedGroups[group.id] ?? false
    const key = thumbnails?.find(
      ({ stepId, before }) => stepId === group.id && before !== true,
    )?.key
    const members = [...group.steps].reverse()
    return (
      <li
        key={group.id}
        draggable
        onDragStart={(event) => {
          handleDragStart(event, group.id)
        }}
        onDragOver={(event) => {
          handleDragOver(event, {
            index: group.steps.length,
            groupId: group.id,
          })
        }}
        onDrop={(event) => {
          handleDrop(event, { index: group.steps.length, groupId: group.id })
        }}
        onDragEnd={handleDragEnd}
      >
        <GroupRow
          group={group}
          position={position}
          count={steps.length}
          selected={selectedId === group.id}
          marked={marked?.includes(group.id) ?? false}
          collapsed={collapsed}
          dragging={draggedId === group.id}
          receiving={overGroupId === group.id && draggedId !== group.id}
          thumbnail={
            key === null || key === undefined
              ? undefined
              : thumbnailImageUrl(documentId, key)
          }
          skipped={
            preview?.problems.find(({ stepId }) => stepId === group.id)?.message
          }
          onSelect={handleSelect}
          onCollapse={handleCollapse}
          onToggle={handleToggle}
          onDelete={handleDelete}
          onMove={handleMove}
        />
        {!collapsed && (
          <ul
            aria-label={`Steps in ${pipelineStepTitle(group)}`}
            className="mt-1 flex flex-col gap-1"
          >
            {members.map((step) =>
              renderStep(step, group.steps.indexOf(step), group.steps, group),
            )}
          </ul>
        )}
      </li>
    )
  }

  return (
    <ul aria-label={`Steps of ${name}`} className="flex flex-col gap-1">
      {topFirst.map((step) => {
        const position = steps.indexOf(step)
        return step.kind === PipelineStepKind.Group
          ? renderGroup(step, position)
          : renderStep(step, position, steps)
      })}
    </ul>
  )
}
