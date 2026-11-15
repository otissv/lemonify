import { RiPlayLine } from '@remixicon/react'
import { useCallback, useState } from 'react'

import { Button } from '@/components/ui/button'
import type { AiContent } from '@/features/ai/ai-tools'
import { defaultAiContent } from '@/features/workflows/ai-tool-entries'
import type { AiToolEntry } from '@/features/workflows/ai-tool-entries'
import type { OutputSettings } from '@/features/workflows/output-settings'
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
import type { Workflow } from '@/features/workflows/workflow'
import { WorkflowCanvas } from '@/features/workflows/workflow-canvas'
import {
  WorkflowNodeKind,
  addInputSources,
  appendStep,
  createAiNode,
  createSharpNode,
  insertStepAfter,
  removeInputSource,
  removeStep,
  updateOutputSettings,
} from '@/features/workflows/workflow-graph'
import type {
  AiNode,
  SharpNode,
  WorkflowNode,
} from '@/features/workflows/workflow-graph'

interface WorkflowPageProps {
  id: string
  aiTools: ReadonlyArray<AiToolEntry>
}

const ORIGIN = { x: 0, y: 0 }
const SAMPLE_NAME = 'photo.jpg'

function patchNode(
  workflow: Workflow,
  id: string,
  patch: (node: WorkflowNode) => WorkflowNode,
): Workflow {
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) => (node.id === id ? patch(node) : node)),
  }
}

function withContent(
  node: WorkflowNode,
  content: AiContent<AiNode>,
): WorkflowNode {
  return node.kind === 'ai' ? { ...node, ...content } : node
}

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
): WorkflowNode | undefined {
  if (choice.kind === 'sharp') return createSharpNode(choice.op, ORIGIN)
  const entry = aiTools.find(({ tool }) => tool.id === choice.tool)
  return entry && createAiNode(defaultAiContent(entry), ORIGIN)
}

/** Builds a pipeline from the image CLI's steps and AI tools, runs it on the chosen images, and offers the results. Every change is saved automatically. */
export function WorkflowPage({
  id,
  aiTools,
}: WorkflowPageProps): React.JSX.Element {
  const editor = useWorkflowEditor(id)
  const runs = useWorkflowRuns(id)
  const sources = useSourcesStore((state) => state.sources)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { update, settle, reload, workflow } = editor

  const handleAdd = useCallback(
    (choice: PaletteChoice): void => {
      const node = newStep(choice, aiTools)
      if (node === undefined) return
      update((current) =>
        selectedId === null
          ? appendStep(current, node)
          : insertStepAfter(current, selectedId, node),
      )
      setSelectedId(node.id)
    },
    [aiTools, selectedId, update],
  )

  const handleOptionsChange = useCallback(
    (stepId: string, options: SharpNode['options']): void => {
      update((current) =>
        patchNode(current, stepId, (node) =>
          node.kind === WorkflowNodeKind.Sharp ? { ...node, options } : node,
        ),
      )
    },
    [update],
  )

  const handleSettingsChange = useCallback(
    (stepId: string, content: AiContent<AiNode>): void => {
      update((current) =>
        patchNode(current, stepId, (node) => withContent(node, content)),
      )
    },
    [update],
  )

  const handleAddSources = useCallback(
    (sourceIds: ReadonlyArray<string>): void => {
      update((current) => addInputSources(current, sourceIds))
    },
    [update],
  )

  const handleRemoveSource = useCallback(
    (sourceId: string): void => {
      update((current) => removeInputSource(current, sourceId))
    },
    [update],
  )

  const handleOutputChange = useCallback(
    (settings: OutputSettings): void => {
      update((current) => updateOutputSettings(current, settings))
    },
    [update],
  )

  const handleRemove = useCallback(
    (stepId: string): void => {
      update((current) => removeStep(current, stepId))
      setSelectedId(null)
    },
    [update],
  )

  const handleRun = useCallback(async (): Promise<void> => {
    await settle()
    await runs.start()
  }, [settle, runs.start])

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

  const selected = workflow.nodes.find((node) => node.id === selectedId)
  const input = workflow.nodes.find(
    (node) => node.kind === WorkflowNodeKind.Input,
  )
  const firstSource =
    input?.kind === WorkflowNodeKind.Input ? input.sourceIds.at(0) : undefined
  const sampleName =
    firstSource === undefined
      ? SAMPLE_NAME
      : sourceFileName(sources, firstSource)
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
          <WorkflowCanvas
            workflow={workflow}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onUpdate={update}
          />
          <RunsPanel runs={runs} />
        </div>
        <StepInspector
          step={selected}
          aiTools={aiTools}
          onOptionsChange={handleOptionsChange}
          onSettingsChange={handleSettingsChange}
          onRemove={handleRemove}
          onAddSources={handleAddSources}
          onRemoveSource={handleRemoveSource}
          onOutputChange={handleOutputChange}
          sampleName={sampleName}
        />
      </div>
    </div>
  )
}
