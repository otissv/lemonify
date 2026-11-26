import { useCallback } from 'react'

import { AppMenuBar } from '@/features/app/app-menu-bar'
import { TabsContent } from '@/components/ui/tabs'
import type { AiToolSummary } from '@/features/ai/ai-tools'
import type { DocumentChange } from '@/features/pipeline/document-change'
import { askForUsedLayer } from '@/features/create-from/add-used-layer'
import { FloatingPanel } from '@/features/tools/floating-panel'
import { LayerTool, LayerTools } from '@/features/tools/layer-tools'
import { ToolTabs, WORKFLOW_TOOLS, shownTool } from '@/features/tools/tool-tabs'
import type { ToolEntry } from '@/features/tools/tool-catalogue'
import { ToolsList } from '@/features/tools/tools-browser'
import type { AiToolEntry } from '@/features/workflows/ai-tool-entries'
import type { NewStepChoice } from '@/features/workflows/new-workflow-step'
import type { OutputSettings } from '@/features/workflows/output-settings'
import type { CanvasSize, Workflow } from '@/features/workflows/workflow'
import { WorkflowOptions } from '@/features/workflows/workflow-options'
import type { Selection } from '@/features/workflows/workflow-selection'
import { Tool, useUiStore } from '@/store/ui-store'

interface WorkflowPanelProps {
  workflow: Workflow
  selection: Selection
  aiTools: ReadonlyArray<AiToolEntry>
  imageName: (sourceId: string) => string
  sampleName: string
  /** Adds a step after the selected one; returns why it could not be added. */
  onAddStep: (choice: NewStepChoice) => string | undefined
  /** Applies a change to the workflow's pipeline, as in a document. */
  onChange: (change: DocumentChange) => void
  onRemove: (stepId: string) => void
  onMove: (stepId: string, delta: -1 | 1) => void
  onAddSources: (sourceIds: ReadonlyArray<string>) => void
  onRemoveSource: (sourceId: string) => void
  onOutputChange: (settings: OutputSettings) => void
  onCanvasSizeChange: (canvasSize: CanvasSize) => void
}

interface WorkflowLayerToolsProps {
  workflowId: string
  onAdd: (choice: NewStepChoice) => void
}

/** The layers a workflow adds from Tools: an empty image layer, a group, or a layer that draws a document or another workflow, chosen in a picker. */
function WorkflowLayerTools({
  workflowId,
  onAdd,
}: WorkflowLayerToolsProps): React.JSX.Element {
  const handleImageLayer = useCallback((): void => {
    onAdd({ kind: 'image-layer' })
  }, [onAdd])
  const handleGroup = useCallback((): void => {
    onAdd({ kind: 'group' })
  }, [onAdd])
  const handleDocumentLayer = useCallback((): void => {
    askForUsedLayer(workflowId, 'document')
  }, [workflowId])
  const handleWorkflowLayer = useCallback((): void => {
    askForUsedLayer(workflowId, 'workflow')
  }, [workflowId])

  return (
    <LayerTools>
      <LayerTool
        label="Image layer"
        actionId="edit.addImageLayer"
        onAdd={handleImageLayer}
      />
      <LayerTool
        label="Document layer"
        actionId="edit.addDocumentLayer"
        onAdd={handleDocumentLayer}
      />
      <LayerTool
        label="Workflow layer"
        actionId="edit.addWorkflowLayer"
        onAdd={handleWorkflowLayer}
      />
      <LayerTool label="Group" onAdd={handleGroup} />
    </LayerTools>
  )
}

/** The floating panel of a workflow: the same panel a document has, with the tabs that apply to a workflow. Tools adds steps and Options shows the selected node (a step, the canvas, the input images or the output); runs are in the side panel beside the diagram. */
export function WorkflowPanel(props: WorkflowPanelProps): React.JSX.Element {
  const { workflow, selection, aiTools, onAddStep } = props
  const activeTool = useUiStore((state) => state.activeTool)
  const setActiveTool = useUiStore((state) => state.setActiveTool)
  const hasSelection = selection.kind !== 'none'
  const shown = shownTool(WORKFLOW_TOOLS, activeTool, hasSelection)
  const tools: ReadonlyArray<AiToolSummary> = aiTools.map(({ tool }) => tool)

  function handleAddTool(tool: ToolEntry): string | undefined {
    return onAddStep(
      tool.kind === 'ai'
        ? { kind: 'ai', value: tool.value }
        : { kind: 'sharp', value: tool.value },
    )
  }

  const handleAddLayer = useCallback(
    (choice: NewStepChoice): void => {
      onAddStep(choice)
    },
    [onAddStep],
  )

  return (
    <FloatingPanel
      label="Tools"
      className="w-80"
      menu={<AppMenuBar workflowId={workflow.id} />}
    >
      <ToolTabs
        tools={WORKFLOW_TOOLS}
        shown={shown}
        optionsAvailable={hasSelection}
        onChange={setActiveTool}
      >
        <TabsContent
          value={Tool.Tools}
          className="min-w-0 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col"
        >
          <ToolsList
            tools={tools}
            onAdd={handleAddTool}
            before={
              <WorkflowLayerTools
                workflowId={workflow.id}
                onAdd={handleAddLayer}
              />
            }
          />
        </TabsContent>
        <TabsContent value={Tool.Options} className="min-w-0 overflow-y-auto">
          <WorkflowOptions
            workflow={workflow}
            selection={selection}
            aiTools={aiTools}
            imageName={props.imageName}
            sampleName={props.sampleName}
            onChange={props.onChange}
            onRemove={props.onRemove}
            onMove={props.onMove}
            onAddSources={props.onAddSources}
            onRemoveSource={props.onRemoveSource}
            onOutputChange={props.onOutputChange}
            onCanvasSizeChange={props.onCanvasSizeChange}
          />
        </TabsContent>
      </ToolTabs>
    </FloatingPanel>
  )
}
