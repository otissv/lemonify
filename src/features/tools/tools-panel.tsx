import { AppMenuBar } from '@/features/app/app-menu-bar'
import { FloatingPanel } from '@/features/tools/floating-panel'
import { ExportOptions } from '@/features/export/export-options'
import { StepOptions } from '@/features/tools/step-options'
import { DOCUMENT_TOOLS, ToolTabs, shownTool } from '@/features/tools/tool-tabs'
import { ToolsBrowser } from '@/features/tools/tools-browser'
import { TabsContent } from '@/components/ui/tabs'
import type { AiCatalogues } from '@/features/ai/ai-defaults'
import type { AiToolSummary } from '@/features/ai/ai-tools'
import { DocumentInfo } from '@/features/documents/document-info'
import { NavigatorPanel } from '@/features/viewport/navigator-panel'
import { ResultsPanel } from '@/features/results/results-panel'
import { Tool, useUiStore } from '@/store/ui-store'

interface ToolsPanelProps {
  documentId: string
  tools: ReadonlyArray<AiToolSummary>
  catalogues: AiCatalogues
}

export function ToolsPanel({
  documentId,
  tools,
  catalogues,
}: ToolsPanelProps): React.JSX.Element {
  const activeTool = useUiStore((state) => state.activeTool)
  const setActiveTool = useUiStore((state) => state.setActiveTool)
  const hasSelectedStep = useUiStore(
    (state) => state.selectedSteps[documentId] !== undefined,
  )
  const shown = shownTool(DOCUMENT_TOOLS, activeTool, hasSelectedStep)

  return (
    <FloatingPanel
      label="Tools"
      className="w-80"
      menu={<AppMenuBar documentId={documentId} />}
    >
      <ToolTabs
        tools={DOCUMENT_TOOLS}
        shown={shown}
        optionsAvailable={hasSelectedStep}
        onChange={setActiveTool}
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
        <TabsContent value={Tool.Document} className="min-w-0 overflow-y-auto">
          <DocumentInfo documentId={documentId} />
        </TabsContent>
        <TabsContent value={Tool.Navigator} className="min-w-0 overflow-y-auto">
          <NavigatorPanel documentId={documentId} />
        </TabsContent>
      </ToolTabs>
    </FloatingPanel>
  )
}
