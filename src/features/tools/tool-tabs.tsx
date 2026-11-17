import {
  RiCompass3Line,
  RiDownload2Line,
  RiEqualizerLine,
  RiFolderImageLine,
  RiInformationLine,
  RiPlayLine,
  RiToolsLine,
} from '@remixicon/react'
import type { RemixiconComponentType } from '@remixicon/react'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tool } from '@/store/ui-store'

const TOOL_LABELS: Readonly<Record<Tool, string>> = {
  [Tool.Tools]: 'Tools',
  [Tool.Options]: 'Options',
  [Tool.Export]: 'Export',
  [Tool.Results]: 'Results',
  [Tool.Document]: 'Document',
  [Tool.Navigator]: 'Navigator',
  [Tool.Run]: 'Run',
}

const TOOL_ICONS: Readonly<Record<Tool, RemixiconComponentType>> = {
  [Tool.Tools]: RiToolsLine,
  [Tool.Options]: RiEqualizerLine,
  [Tool.Export]: RiDownload2Line,
  [Tool.Results]: RiFolderImageLine,
  [Tool.Document]: RiInformationLine,
  [Tool.Navigator]: RiCompass3Line,
  [Tool.Run]: RiPlayLine,
}

/** The tabs a document's panel has. Nothing a workflow does appears here. */
export const DOCUMENT_TOOLS: ReadonlyArray<Tool> = [
  Tool.Tools,
  Tool.Options,
  Tool.Export,
  Tool.Results,
  Tool.Document,
  Tool.Navigator,
]

/** The tabs a workflow's panel has. Nothing a document does appears here. */
export const WORKFLOW_TOOLS: ReadonlyArray<Tool> = [
  Tool.Tools,
  Tool.Options,
  Tool.Run,
]

function isTool(value: string): value is Tool {
  return Object.values<string>(Tool).includes(value)
}

/** The tab to show: the active tool when this panel has it and it can be used, and otherwise Tools. */
export function shownTool(
  tools: ReadonlyArray<Tool>,
  active: Tool,
  optionsAvailable: boolean,
): Tool {
  if (!tools.includes(active)) return Tool.Tools
  return active === Tool.Options && !optionsAvailable ? Tool.Tools : active
}

interface ToolTabsProps {
  tools: ReadonlyArray<Tool>
  shown: Tool
  /** Whether the Options tab has anything to show. */
  optionsAvailable: boolean
  onChange: (tool: Tool) => void
  /** The `TabsContent` of each tool. */
  children: React.ReactNode
}

/** A panel's tools: each one's content beside a column of icon tabs. */
export function ToolTabs({
  tools,
  shown,
  optionsAvailable,
  onChange,
  children,
}: ToolTabsProps): React.JSX.Element {
  function handleChange(value: string): void {
    if (isTool(value)) onChange(value)
  }

  return (
    <Tabs
      orientation="vertical"
      value={shown}
      onValueChange={handleChange}
      className="min-h-0 flex-1 flex-row gap-0"
    >
      {children}
      <TabsList
        variant="line"
        className="h-auto shrink-0 justify-start gap-0 self-stretch border-0 bg-transparent p-0 group-data-[orientation=vertical]/tabs:h-auto"
      >
        {tools.map((tool) => {
          const Icon = TOOL_ICONS[tool]
          return (
            <TabsTrigger
              key={tool}
              value={tool}
              disabled={tool === Tool.Options && !optionsAvailable}
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
  )
}
