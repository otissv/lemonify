import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SidePanelTab, useUiStore } from '@/store/ui-store'

interface WorkflowSidePanelProps {
  /** The large picture of the selected node. */
  preview: React.ReactNode
  /** Starting runs and following them. */
  runs: React.ReactNode
}

function isSidePanelTab(value: string): value is SidePanelTab {
  return Object.values<string>(SidePanelTab).includes(value)
}

/** The panel beside a workflow's diagram, with a tab for the selected node's picture and one for the runs; the View menu opens it on either. */
export function WorkflowSidePanel({
  preview,
  runs,
}: WorkflowSidePanelProps): React.JSX.Element {
  const tab = useUiStore((state) => state.workflowSidePanelTab)
  const showTab = useUiStore((state) => state.showWorkflowSidePanel)

  function handleTabChange(value: string): void {
    if (isSidePanelTab(value)) showTab(value)
  }

  return (
    <Tabs
      value={tab}
      onValueChange={handleTabChange}
      className="size-full min-h-0 gap-0"
    >
      <TabsList className="m-2 shrink-0">
        <TabsTrigger value={SidePanelTab.Preview}>Preview</TabsTrigger>
        <TabsTrigger value={SidePanelTab.Runs}>Runs</TabsTrigger>
      </TabsList>
      <TabsContent value={SidePanelTab.Preview} className="relative min-h-0">
        {preview}
      </TabsContent>
      <TabsContent value={SidePanelTab.Runs} className="min-h-0">
        {runs}
      </TabsContent>
    </Tabs>
  )
}
