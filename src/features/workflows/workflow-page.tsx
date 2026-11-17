import { RiPlayLine } from '@remixicon/react'
import { useCallback, useState } from 'react'

import { Button } from '@/components/ui/button'
import type { DocumentChange } from '@/features/pipeline/document-change'
import { createImageLayerStep } from '@/features/pipeline/layer-kinds'
import {
  createAiStep,
  createGroupStep,
  createSharpStep,
} from '@/features/pipeline/pipeline'
import type { PipelineStep } from '@/features/pipeline/pipeline'
import { defaultAiContent } from '@/features/workflows/ai-tool-entries'
import type { AiToolEntry } from '@/features/workflows/ai-tool-entries'
import type { OutputSettings } from '@/features/workflows/output-settings'
import { RunCanvasSelect } from '@/features/workflows/run-canvas-select'
import { RunsPanel } from '@/features/workflows/runs-panel'
import {
  sourceFileName,
  useSourcesStore,
} from '@/features/workflows/sources-store'
import { StepInspector } from '@/features/workflows/step-inspector'
import { StepPalette } from '@/features/workflows/step-palette'
import type { PaletteChoice } from '@/features/workflows/step-palette'
import {
  EditorStatus,
  SaveStatus,
  useWorkflowEditor,
} from '@/features/workflows/use-workflow-editor'
import { useWorkflowRuns } from '@/features/workflows/use-workflow-runs'
import { RunCanvasMode } from '@/features/workflows/workflow'
import {
  addInputs,
  addStepAfter,
  changePipeline,
  moveStepBy,
  removeInput,
  withOutput,
} from '@/features/workflows/workflow-edit'
import {
  NO_SELECTION,
  selectedStepId,
  stepSelection,
} from '@/features/workflows/workflow-selection'
import type { Selection } from '@/features/workflows/workflow-selection'
import { WorkflowStepList } from '@/features/workflows/workflow-step-list'

interface WorkflowPageProps {
  id: string
  aiTools: ReadonlyArray<AiToolEntry>
}

const SAMPLE_NAME = 'photo.jpg'

function saveMessage(save: SaveStatus, error: string | null): string {
  switch (save) {
    case SaveStatus.Saving:
      return 'Saving…'
    case SaveStatus.Saved:
      return 'Saved'
    case SaveStatus.Failed:
      return `Not saved: ${error ?? 'unknown error'}`
  }
}

function newStep(
  choice: PaletteChoice,
  aiTools: ReadonlyArray<AiToolEntry>,
): PipelineStep | undefined {
  switch (choice.kind) {
    case 'sharp':
      return createSharpStep(choice.op)
    case 'image-layer':
      return createImageLayerStep()
    case 'group':
      return createGroupStep([])
    case 'ai': {
      const entry = aiTools.find(({ tool }) => tool.id === choice.tool)
      return entry && createAiStep(defaultAiContent(entry))
    }
  }
}

/** Builds a workflow like a document: a canvas, image layers and steps in order, where an image layer with no image is where each input image goes. Runs it on the chosen images and offers the results. Every change is saved automatically. */
export function WorkflowPage({
  id,
  aiTools,
}: WorkflowPageProps): React.JSX.Element {
  const editor = useWorkflowEditor(id)
  const runs = useWorkflowRuns(id)
  const sources = useSourcesStore((state) => state.sources)
  const [selection, setSelection] = useState<Selection>(NO_SELECTION)
  const [canvasMode, setCanvasMode] = useState<RunCanvasMode>(
    RunCanvasMode.Workflow,
  )
  const { update, settle, reload, workflow } = editor
  const selectedId = selectedStepId(selection)

  const imageName = useCallback(
    (sourceId: string): string => sourceFileName(sources, sourceId),
    [sources],
  )

  const handleAdd = useCallback(
    (choice: PaletteChoice): void => {
      const step = newStep(choice, aiTools)
      if (step === undefined) return
      update((current) => addStepAfter(current, step, selectedId))
      setSelection(stepSelection(step.id))
    },
    [aiTools, selectedId, update],
  )

  const handleChange = useCallback(
    (change: DocumentChange): void => {
      update((current) => changePipeline(current, change))
    },
    [update],
  )

  const handleEnabledChange = useCallback(
    (stepId: string, enabled: boolean): void => {
      handleChange({ type: 'set-enabled', stepId, enabled })
    },
    [handleChange],
  )

  const handleMove = useCallback(
    (stepId: string, delta: -1 | 1): void => {
      update((current) => moveStepBy(current, stepId, delta))
    },
    [update],
  )

  const handleAddSources = useCallback(
    (sourceIds: ReadonlyArray<string>): void => {
      update((current) => addInputs(current, sourceIds))
    },
    [update],
  )

  const handleRemoveSource = useCallback(
    (sourceId: string): void => {
      update((current) => removeInput(current, sourceId))
    },
    [update],
  )

  const handleOutputChange = useCallback(
    (settings: OutputSettings): void => {
      update((current) => withOutput(current, settings))
    },
    [update],
  )

  const handleRemove = useCallback(
    (stepId: string): void => {
      handleChange({ type: 'remove-step', stepId })
      setSelection(NO_SELECTION)
    },
    [handleChange],
  )

  const handleRun = useCallback(async (): Promise<void> => {
    await settle()
    await runs.start(canvasMode)
  }, [settle, runs.start, canvasMode])

  const handleReload = useCallback((): void => {
    void reload()
  }, [reload])

  if (editor.status === EditorStatus.Loading) {
    return (
      <p role="status" className="p-6 text-body-md text-muted-foreground">
        Loading…
      </p>
    )
  }
  if (editor.status === EditorStatus.Failed || workflow === null) {
    return (
      <p role="alert" className="p-6 text-body-md text-muted-foreground">
        {editor.loadError ?? 'This workflow does not exist.'}
      </p>
    )
  }

  const [firstSource] = workflow.inputs
  const sampleName =
    firstSource === undefined ? SAMPLE_NAME : imageName(firstSource)
  const failed = editor.save === SaveStatus.Failed

  return (
    <div className="flex size-full min-h-0 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
        <h1 className="truncate text-title-md">{workflow.name}</h1>
        <div className="flex items-center gap-3">
          <p
            role="status"
            className={
              failed
                ? 'text-caption text-destructive'
                : 'text-caption text-muted-foreground'
            }
          >
            {saveMessage(editor.save, editor.saveError)}
          </p>
          {failed && (
            <Button variant="secondary" size="sm" onClick={handleReload}>
              Reload
            </Button>
          )}
          <RunCanvasSelect value={canvasMode} onChange={setCanvasMode} />
          <Button size="sm" disabled={failed} onClick={() => void handleRun()}>
            <RiPlayLine aria-hidden="true" />
            Run
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <StepPalette
          aiTools={aiTools.map(({ tool }) => tool)}
          onAdd={handleAdd}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <WorkflowStepList
            workflow={workflow}
            selection={selection}
            onSelect={setSelection}
            onEnabledChange={handleEnabledChange}
            onMove={handleMove}
            onRemove={handleRemove}
            imageName={imageName}
          />
          <RunsPanel runs={runs} />
        </div>
        <StepInspector
          workflow={workflow}
          selection={selection}
          aiTools={aiTools}
          onChange={handleChange}
          onRemove={handleRemove}
          onAddSources={handleAddSources}
          onRemoveSource={handleRemoveSource}
          onOutputChange={handleOutputChange}
          imageName={imageName}
          sampleName={sampleName}
        />
      </div>
    </div>
  )
}
