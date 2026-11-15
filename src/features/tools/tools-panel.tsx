import {
  RiDownload2Line,
  RiEqualizerLine,
  RiFolderImageLine,
  RiToolsLine,
} from '@remixicon/react'
import type { RemixiconComponentType } from '@remixicon/react'

import { AppMenuBar } from '@/features/app/app-menu-bar'
import { FloatingPanel } from '@/features/tools/floating-panel'
import { ExportOptions } from '@/features/export/export-options'
import { StepOptions } from '@/features/tools/step-options'
import { ToolsBrowser } from '@/features/tools/tools-browser'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { AiCatalogues } from '@/features/ai/ai-defaults'
import type { AiToolSummary } from '@/features/ai/ai-tools'
import { ResultsPanel } from '@/features/results/results-panel'
import { Tool, useAppStore } from '@/store/app-store'

interface ToolsPanelProps {
  documentId: string
  tools: ReadonlyArray<AiToolSummary>
  catalogues: AiCatalogues
}

const TOOL_LABELS: Readonly<Record<Tool, string>> = {
  [Tool.Tools]: 'Tools',
  [Tool.Options]: 'Options',
  [Tool.Export]: 'Export',
  [Tool.Results]: 'Results',
}

const TOOL_ICONS: Readonly<Record<Tool, RemixiconComponentType>> = {
  [Tool.Tools]: RiToolsLine,
  [Tool.Options]: RiEqualizerLine,
  [Tool.Export]: RiDownload2Line,
  [Tool.Results]: RiFolderImageLine,
}

const TOOLS: ReadonlyArray<Tool> = [
  Tool.Tools,
  Tool.Options,
  Tool.Export,
  Tool.Results,
]

function isTool(value: string): value is Tool {
  return Object.values<string>(Tool).includes(value)
}

export function ToolsPanel({
  documentId,
  tools,
  catalogues,
}: ToolsPanelProps): React.JSX.Element {
  const activeTool = useAppStore((state) => state.activeTool)
  const setActiveTool = useAppStore((state) => state.setActiveTool)

  function handleToolChange(value: string): void {
    if (isTool(value)) setActiveTool(value)
  }

  return (
    <FloatingPanel
      label="Tools"
      className="w-80"
      menu={<AppMenuBar documentId={documentId} />}
    >
      <Tabs
        orientation="vertical"
        value={activeTool}
        onValueChange={handleToolChange}
        className="min-h-0 flex-1 flex-row gap-0"
      >
        <TabsContent
          value={Tool.Tools}
          className="min-w-0 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col"
        >
          <ToolsBrowser
            documentId={documentId}
            tools={tools}
            catalogues={catalogues}
          />
        </TabsContent>
        <TabsContent value={Tool.Options} className="min-w-0 overflow-y-auto">
          <StepOptions documentId={documentId} catalogues={catalogues} />
        </TabsContent>
        <TabsContent value={Tool.Export} className="min-w-0 overflow-y-auto">
          <ExportOptions documentId={documentId} />
        </TabsContent>
        <TabsContent value={Tool.Results} className="min-w-0 overflow-y-auto">
          <ResultsPanel documentId={documentId} />
        </TabsContent>
        <TabsList
          variant="line"
          className="h-auto shrink-0 justify-start gap-0 self-stretch border-0 bg-transparent p-0 group-data-[orientation=vertical]/tabs:h-auto"
        >
          {TOOLS.map((tool) => {
            const Icon = TOOL_ICONS[tool]
            return (
              <TabsTrigger
                key={tool}
                value={tool}
                aria-label={TOOL_LABELS[tool]}
                className="size-10 flex-none rounded-none border-0 p-0 after:hidden group-data-[orientation=vertical]/tabs:w-10 group-data-[orientation=vertical]/tabs:justify-center group-data-[variant=line]/tabs-list:data-[state=active]:bg-foreground/15"
                title={TOOL_LABELS[tool]}
              >
                <Icon aria-hidden="true" className="size-5" />
              </TabsTrigger>
            )
          })}
        </TabsList>
      </Tabs>
    </FloatingPanel>
  )
}
