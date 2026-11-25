import { RiAddLine } from '@remixicon/react'

import { AppMenuBar } from '@/features/app/app-menu-bar'
import { Button } from '@/components/ui/button'
import { TabsContent } from '@/components/ui/tabs'
import type { AiToolSummary } from '@/features/ai/ai-tools'
import type { DocumentChange } from '@/features/pipeline/document-change'
import { FloatingPanel } from '@/features/tools/floating-panel'
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

interface LayerButtonsProps {
  onAdd: (choice: NewStepChoice) => void
}

function LayerButtons({ onAdd }: LayerButtonsProps): React.JSX.Element {
  function handleLayer(): void {
    onAdd({ kind: 'image-layer' })
  }

  function handleGroup(): void {
    onAdd({ kind: 'group' })
  }

  return (
    <div className="flex flex-col gap-1">
      <h3 className="px-2 py-1 text-caption font-medium text-muted-foreground">
        Layers
      </h3>
      <ul className="flex flex-col">
        <li>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Add Image layer"
            className="w-full justify-start gap-2 px-2"
            onClick={handleLayer}
          >
            <RiAddLine aria-hidden="true" />
            Image layer
          </Button>
        </li>
        <li>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Add Group"
            className="w-full justify-start gap-2 px-2"
            onClick={handleGroup}
          >
            <RiAddLine aria-hidden="true" />
            Group
          </Button>
        </li>
      </ul>
    </div>
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

  function handleAddLayer(choice: NewStepChoice): void {
    onAddStep(choice)
  }

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
            before={<LayerButtons onAdd={handleAddLayer} />}
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
