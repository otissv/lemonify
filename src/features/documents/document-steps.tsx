import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import type { SourceSummary } from '@/features/documents/document'
import { PipelineStepKind, canvasLayer } from '@/features/pipeline/pipeline'
import type { PipelineStep } from '@/features/pipeline/pipeline'
import { thumbnailImageUrl } from '@/features/documents/image-urls'
import { useDocument } from '@/features/documents/use-document'
import { StepRow } from '@/features/documents/step-row'
import { setStepDrag } from '@/features/documents/step-drag'
import {
  deleteStep,
  reorderStep,
  setStepOn,
} from '@/features/pipeline/pipeline-actions'
import { usePreview } from '@/features/pipeline/use-preview'
import { useStepThumbnails } from '@/features/pipeline/use-step-thumbnails'
import { Tool, useAppStore } from '@/store/app-store'

function sourceNameOf(
  step: PipelineStep,
  sources: ReadonlyArray<SourceSummary> | undefined,
): string | undefined {
  if (step.kind !== PipelineStepKind.Layer) return undefined
  return sources?.find(({ id }) => id === step.sourceId)?.fileName
}

interface DocumentStepsProps {
  documentId: string
  name: string
}

/** The steps of one document, the last on top as in a layer panel, so the layer that sets the canvas is lowest: select, switch off, delete, and reorder by dragging or with the buttons. Dragging one onto another document in the sidebar copies it there. */
export function DocumentSteps({
  documentId,
  name,
}: DocumentStepsProps): React.JSX.Element {
  const navigate = useNavigate()
  useDocument(documentId)
  const preview = usePreview(documentId)
  const selectedId = useAppStore((state) => state.selectedSteps[documentId])
  const thumbnails = useAppStore((state) => state.thumbnails[documentId])
  const run = useAppStore((state) => state.aiRuns[documentId])
  const selectStep = useAppStore((state) => state.selectStep)
  const setActiveTool = useAppStore((state) => state.setActiveTool)
  const [draggedId, setDraggedId] = useState<string | undefined>(undefined)
  useStepThumbnails(documentId, true)

  const steps = preview?.pipeline.steps ?? []
  const topFirst = [...steps].reverse()
  const canvasId = preview ? canvasLayer(preview.pipeline)?.id : undefined
  if (steps.length === 0) {
    return (
      <p className="px-2 py-1 text-caption text-muted-foreground">
        No edits yet.
      </p>
    )
  }

  function handleSelect(stepId: string): void {
    selectStep(documentId, stepId)
    setActiveTool(Tool.Options)
    void navigate({ to: '/documents/$id', params: { id: documentId } })
  }

  function handleToggle(stepId: string, isOn: boolean): void {
    setStepOn(documentId, stepId, isOn)
  }

  function handleDelete(stepId: string): void {
    deleteStep(documentId, stepId)
  }

  function handleMove(stepId: string, index: number): void {
    reorderStep(documentId, stepId, index)
  }

  function handleDragStart(
    event: React.DragEvent<HTMLLIElement>,
    stepId: string,
  ): void {
    event.dataTransfer.setData('text/plain', stepId)
    setStepDrag(event.dataTransfer, { documentId, stepId })
    event.dataTransfer.effectAllowed = 'copyMove'
    setDraggedId(stepId)
  }

  function handleDragOver(event: React.DragEvent<HTMLLIElement>): void {
    if (draggedId === undefined) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }

  function handleDrop(
    event: React.DragEvent<HTMLLIElement>,
    index: number,
  ): void {
    if (draggedId === undefined) return
    event.preventDefault()
    reorderStep(documentId, draggedId, index)
    setDraggedId(undefined)
  }

  function handleDragEnd(): void {
    setDraggedId(undefined)
  }

  return (
    <ul aria-label={`Steps of ${name}`} className="flex flex-col gap-1">
      {topFirst.map((step) => {
        const position = steps.indexOf(step)
        const key = thumbnails?.find(({ stepId }) => stepId === step.id)?.key
        return (
          <li
            key={step.id}
            draggable
            onDragStart={(event) => {
              handleDragStart(event, step.id)
            }}
            onDragOver={handleDragOver}
            onDrop={(event) => {
              handleDrop(event, position)
            }}
            onDragEnd={handleDragEnd}
          >
            <StepRow
              documentId={documentId}
              step={step}
              position={position}
              count={steps.length}
              selected={selectedId === step.id}
              dragging={draggedId === step.id}
              thumbnail={
                key === null || key === undefined
                  ? undefined
                  : thumbnailImageUrl(documentId, key)
              }
              sourceName={sourceNameOf(step, preview?.document.sources)}
              canvas={step.id === canvasId}
              outOfDate={preview?.pending.includes(step.id) ?? false}
              skipped={
                preview?.problems.find(({ stepId }) => stepId === step.id)
                  ?.message
              }
              run={run}
              onSelect={handleSelect}
              onToggle={handleToggle}
              onDelete={handleDelete}
              onMove={handleMove}
            />
          </li>
        )
      })}
    </ul>
  )
}
