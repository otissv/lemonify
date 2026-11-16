import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import type { SourceSummary } from '@/features/documents/document'
import { PipelineStepKind } from '@/features/pipeline/pipeline'
import type { PipelineStep } from '@/features/pipeline/pipeline'
import { thumbnailImageUrl } from '@/features/documents/image-urls'
import { useDocument } from '@/features/documents/use-document'
import { StepRow } from '@/features/documents/step-row'
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
  if (step.kind !== PipelineStepKind.Source) return undefined
  return sources?.find(({ id }) => id === step.sourceId)?.fileName
}

interface DocumentStepsProps {
  documentId: string
  name: string
}

/** The steps of one document, in order: select, switch off, delete, and reorder by dragging or with the buttons. */
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
    event.dataTransfer.effectAllowed = 'move'
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
    event.preventDefault()
    if (draggedId !== undefined) reorderStep(documentId, draggedId, index)
    setDraggedId(undefined)
  }

  function handleDragEnd(): void {
    setDraggedId(undefined)
  }

  return (
    <ul aria-label={`Steps of ${name}`} className="flex flex-col gap-1">
      {steps.map((step, position) => {
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
