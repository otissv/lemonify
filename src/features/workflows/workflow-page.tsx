import { useCallback, useEffect, useMemo, useRef } from 'react'

import { ResizeHandle } from '@/components/ui/resize-handle'
import { MenuPanel } from '@/features/app/menu-panel'
import type { AiCatalogues } from '@/features/ai/ai-defaults'
import { Page } from '@/features/keybindings/actions'
import { KeyBindings } from '@/features/keybindings/key-bindings'
import type { DocumentChange } from '@/features/pipeline/document-change'
import { shownWorkflow } from '@/features/pipeline/pipeline-session'
import {
  applyEdit,
  applyWorkflowEdit,
  settlePipeline,
} from '@/features/pipeline/pipeline-sync'
import type { AiToolEntry } from '@/features/workflows/ai-tool-entries'
import { newWorkflowStep } from '@/features/workflows/new-workflow-step'
import type { NewStepChoice } from '@/features/workflows/new-workflow-step'
import type { OutputSettings } from '@/features/workflows/output-settings'
import { useRunPolling } from '@/features/workflows/use-run-polling'
import { useWorkflowThumbnails } from '@/features/workflows/use-workflow-thumbnails'
import { useWorkflow } from '@/features/workflows/use-workflow'
import type { CanvasSize, Workflow } from '@/features/workflows/workflow'
import { WorkflowCanvas } from '@/features/workflows/workflow-canvas'
import { WorkflowNodePreview } from '@/features/workflows/workflow-node-preview'
import { WorkflowNotices } from '@/features/workflows/workflow-notices'
import { WorkflowSidePanel } from '@/features/workflows/workflow-side-panel'
import { RunsPanel } from '@/features/workflows/runs/runs-panel'
import {
  addInputsChange,
  addStepChange,
  moveStepChange,
  removeInputChange,
} from '@/features/workflows/workflow-edit'
import { WorkflowPanel } from '@/features/workflows/workflow-panel'
import {
  NO_SELECTION,
  previewNodeIdForSelection,
  stepSelection,
} from '@/features/workflows/workflow-selection'
import type { Selection } from '@/features/workflows/workflow-selection'
import { sourceFileName, useLibraryStore } from '@/store/library-store'
import { usePipelineStore, workflowSession } from '@/store/pipeline-store'
import { findStep } from '@/features/pipeline/pipeline'
import { stepLabel } from '@/features/workflows/workflow-steps'
import {
  DEFAULT_WORKFLOW_SIDE_PANEL_SHARE,
  SidePanelTab,
  Tool,
  useUiStore,
} from '@/store/ui-store'

interface WorkflowPageProps {
  id: string
  aiTools: ReadonlyArray<AiToolEntry>
}

const SAMPLE_NAME = 'photo.jpg'
const MIN_SIDE_PANEL_SHARE = 0.2
const MAX_SIDE_PANEL_SHARE = 0.8

const FOCUS_LABELS = {
  canvas: 'Canvas',
  inputs: 'Input images',
  output: 'Output',
} as const

/** What the large picture is of, for its text alternative: the selected step or part, or the output. */
function previewName(workflow: Workflow, selection: Selection): string {
  switch (selection.kind) {
    case 'none':
      return FOCUS_LABELS.output
    case 'step': {
      const found = findStep(workflow.pipeline, selection.id)?.step
      return found === undefined ? FOCUS_LABELS.output : stepLabel(found)
    }
    default:
      return FOCUS_LABELS[selection.kind]
  }
}

/** The workflow as shown now, with the edits not yet saved. */
function currentWorkflow(
  id: string,
): ReturnType<typeof shownWorkflow> | undefined {
  const session = workflowSession(usePipelineStore.getState(), id)
  return session === undefined ? undefined : shownWorkflow(session)
}

function cataloguesOf(aiTools: ReadonlyArray<AiToolEntry>): AiCatalogues {
  return aiTools.map(({ tool, catalogue }) => ({ tool: tool.id, catalogue }))
}

function PageMessage({
  role,
  children,
}: {
  role: 'status' | 'alert'
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div data-slot="tools-panel-bounds" className="relative size-full">
      <p role={role} className="p-6 text-body-md text-muted-foreground">
        {children}
      </p>
      <MenuPanel />
    </div>
  )
}

/** A workflow as a diagram on the left of the page, with the same floating panel a document has over it, and a side panel on the right, which takes half the width until its left border is dragged and shows either the large picture of the selected node or the workflow's runs. Selecting a node shows its options in the panel and its picture on the right, and tools are added there. It is held and edited in the store like a document: every change is one entry in its Edit history, shown at once and saved in order. */
export function WorkflowPage({
  id,
  aiTools,
}: WorkflowPageProps): React.JSX.Element {
  const { session, loadError } = useWorkflow(id)
  useRunPolling(id)
  useWorkflowThumbnails(id, session !== undefined)
  const sources = useLibraryStore((state) => state.sources)
  const startRun = useLibraryStore((state) => state.startRun)
  const stepId = useUiStore((state) => state.selectedSteps[id])
  const focus = useUiStore((state) => state.workflowFocus[id])
  const setActiveTool = useUiStore((state) => state.setActiveTool)
  const selectInWorkflow = useUiStore((state) => state.selectInWorkflow)
  const visitItem = useUiStore((state) => state.visitItem)
  const sidePanelShare = useUiStore((state) => state.workflowSidePanelShare)
  const setSidePanelShare = useUiStore(
    (state) => state.setWorkflowSidePanelShare,
  )
  const sidePanelOpen = useUiStore((state) => state.workflowSidePanelOpen)
  const showSidePanel = useUiStore((state) => state.showWorkflowSidePanel)
  const splitRef = useRef<HTMLDivElement>(null)
  const catalogues = useMemo(() => cataloguesOf(aiTools), [aiTools])

  useEffect(() => {
    if (useUiStore.getState().visitTrail.at(-1) !== id) visitItem(id)
  }, [id, visitItem])

  const workflow = useMemo<Workflow | undefined>(
    () =>
      session === undefined
        ? undefined
        : { id, name: session.confirmed.name, ...shownWorkflow(session) },
    [session, id],
  )
  const selection = useMemo<Selection>(() => {
    if (focus !== undefined) return { kind: focus }
    return stepId === undefined ? NO_SELECTION : stepSelection(stepId)
  }, [focus, stepId])

  const imageName = useCallback(
    (sourceId: string): string => sourceFileName(sources, sourceId),
    [sources],
  )

  const handleSelect = useCallback(
    (next: Selection): void => {
      selectInWorkflow(id, next)
      if (next.kind === 'none') return
      setActiveTool(Tool.Options)
      showSidePanel(SidePanelTab.Preview)
    },
    [id, selectInWorkflow, setActiveTool, showSidePanel],
  )

  const handleAddStep = useCallback(
    (choice: NewStepChoice): string | undefined => {
      if (workflow === undefined) return undefined
      const made = newWorkflowStep(choice, catalogues)
      if ('problem' in made) return made.problem
      void applyEdit(id, addStepChange(workflow, made.step, stepId ?? null))
      handleSelect(stepSelection(made.step.id))
      return undefined
    },
    [id, workflow, catalogues, stepId, handleSelect],
  )

  const handleChange = useCallback(
    (change: DocumentChange): void => {
      void applyEdit(id, change)
    },
    [id],
  )

  const handleMove = useCallback(
    (movedId: string, delta: -1 | 1): void => {
      if (workflow === undefined) return
      const change = moveStepChange(workflow, movedId, delta)
      if (change !== undefined) void applyEdit(id, change)
    },
    [id, workflow],
  )

  // An upload adds its images when it finishes, so the inputs are read when
  // the change is made, not when the page last drew; otherwise an image added
  // during the upload would be lost.
  const handleAddSources = useCallback(
    (sourceIds: ReadonlyArray<string>): void => {
      const current = currentWorkflow(id)
      if (current === undefined) return
      const change = addInputsChange(current, sourceIds)
      if (change !== undefined) void applyWorkflowEdit(id, change)
    },
    [id],
  )

  const handleRemoveSource = useCallback(
    (sourceId: string): void => {
      const current = currentWorkflow(id)
      if (current === undefined) return
      const change = removeInputChange(current, sourceId)
      if (change !== undefined) void applyWorkflowEdit(id, change)
    },
    [id],
  )

  const handleCanvasSizeChange = useCallback(
    (canvasSize: CanvasSize): void => {
      void applyWorkflowEdit(id, { type: 'set-canvas-size', canvasSize })
    },
    [id],
  )

  const handleOutputChange = useCallback(
    (output: OutputSettings): void => {
      void applyWorkflowEdit(id, { type: 'set-output', output })
    },
    [id],
  )

  const handleRemove = useCallback(
    (removedId: string): void => {
      void applyEdit(id, { type: 'remove-step', stepId: removedId })
      selectInWorkflow(id, NO_SELECTION)
    },
    [id, selectInWorkflow],
  )

  const handleRun = useCallback(
    async (sourceIds: string[]): Promise<void> => {
      await settlePipeline(id)
      await startRun(id, sourceIds)
    },
    [id, startRun],
  )

  if (workflow === undefined) {
    return loadError === undefined ? (
      <PageMessage role="status">Loading…</PageMessage>
    ) : (
      <PageMessage role="alert">{loadError}</PageMessage>
    )
  }

  const [firstSource] = workflow.inputs
  const sampleName =
    firstSource === undefined ? SAMPLE_NAME : imageName(firstSource)

  return (
    <div ref={splitRef} className="flex size-full">
      <div data-slot="tools-panel-bounds" className="relative min-w-0 flex-1">
        <WorkflowCanvas
          workflow={workflow}
          selection={selection}
          onSelect={handleSelect}
          onRemoveStep={handleRemove}
          imageName={imageName}
        />
        <KeyBindings
          page={Page.Workflow}
          documentId={id}
          catalogues={catalogues}
        />
        <WorkflowPanel
          workflow={workflow}
          selection={selection}
          aiTools={aiTools}
          imageName={imageName}
          sampleName={sampleName}
          onAddStep={handleAddStep}
          onChange={handleChange}
          onRemove={handleRemove}
          onMove={handleMove}
          onAddSources={handleAddSources}
          onRemoveSource={handleRemoveSource}
          onOutputChange={handleOutputChange}
          onCanvasSizeChange={handleCanvasSizeChange}
        />
        <WorkflowNotices workflowId={id} />
      </div>
      {sidePanelOpen && (
        <>
          <ResizeHandle
            label="Resize side panel"
            value={sidePanelShare}
            defaultValue={DEFAULT_WORKFLOW_SIDE_PANEL_SHARE}
            min={MIN_SIDE_PANEL_SHARE}
            max={MAX_SIDE_PANEL_SHARE}
            panelSide="end"
            boundsRef={splitRef}
            onChange={setSidePanelShare}
          />
          <section
            aria-label="Side panel"
            className="relative min-w-0 shrink-0"
            style={{ width: `${sidePanelShare * 100}%` }}
          >
            <WorkflowSidePanel
              preview={
                <WorkflowNodePreview
                  workflowId={id}
                  nodeId={previewNodeIdForSelection(selection)}
                  name={previewName(workflow, selection)}
                />
              }
              runs={
                <RunsPanel
                  workflowId={id}
                  inputs={workflow.inputs}
                  imageName={imageName}
                  onRun={handleRun}
                />
              }
            />
          </section>
        </>
      )}
    </div>
  )
}
