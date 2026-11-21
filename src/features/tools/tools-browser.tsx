import { RiAddLine, RiArrowDownSLine, RiSearchLine } from '@remixicon/react'
import { useCallback, useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { AiCatalogues } from '@/features/ai/ai-defaults'
import type { AiToolSummary } from '@/features/ai/ai-tools'
import { toolActionId } from '@/features/keybindings/actions'
import { useActionHint } from '@/features/keybindings/use-action-hint'
import { addTool } from '@/features/tools/add-tool'
import { searchTools, toolGroups } from '@/features/tools/tool-catalogue'
import type { ToolEntry } from '@/features/tools/tool-catalogue'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/store/ui-store'

interface ToolsBrowserProps {
  documentId: string
  tools: ReadonlyArray<AiToolSummary>
  catalogues: AiCatalogues
}

interface ToolsListProps {
  tools: ReadonlyArray<AiToolSummary>
  /** Adds the tool; returns why it could not be added, or nothing when it was. */
  onAdd: (tool: ToolEntry) => string | undefined
  /** Shown above the groups, for what only some pages offer. */
  before?: React.ReactNode
}

interface ToolGroupProps {
  label: string
  tools: ReadonlyArray<ToolEntry>
  open: boolean
  onToggle: (label: string) => void
  onAdd: (tool: ToolEntry) => void
}

interface ToolRowProps {
  tool: ToolEntry
  onAdd: (tool: ToolEntry) => void
}

function ToolRow({ tool, onAdd }: ToolRowProps): React.JSX.Element {
  const hint = useActionHint(toolActionId(tool.kind, tool.value))

  function handleClick(): void {
    onAdd(tool)
  }

  return (
    <li>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Add ${tool.label}`}
        aria-keyshortcuts={hint.aria}
        title={hint.titled(`Add ${tool.label}`)}
        className="w-full justify-start gap-2 px-2"
        onClick={handleClick}
      >
        <RiAddLine aria-hidden="true" />
        {tool.label}
        {hint.shown !== undefined && (
          <kbd className="ml-auto font-mono text-caption text-muted-foreground">
            {hint.shown}
          </kbd>
        )}
      </Button>
    </li>
  )
}

function ToolGroupList({
  label,
  tools,
  open,
  onToggle,
  onAdd,
}: ToolGroupProps): React.JSX.Element {
  const listId = useId()

  function handleToggle(): void {
    onToggle(label)
  }

  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-caption font-medium text-muted-foreground">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onClick={handleToggle}
        >
          {label}
          <RiArrowDownSLine
            aria-hidden="true"
            className={cn('size-4 transition-transform', !open && '-rotate-90')}
          />
        </button>
      </h3>
      <ul id={listId} hidden={!open} className="flex flex-col">
        {tools.map((tool) => (
          <ToolRow key={tool.value} tool={tool} onAdd={onAdd} />
        ))}
      </ul>
    </div>
  )
}

/** Every editing tool, grouped and searchable. Choosing one hands it to `onAdd`. A document and a workflow both browse tools here, and each adds them to its own steps. */
export function ToolsList({
  tools,
  onAdd,
  before,
}: ToolsListProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const openGroups = useUiStore((state) => state.openToolGroups)
  const setToolGroupOpen = useUiStore((state) => state.setToolGroupOpen)
  const searchId = useId()
  const groups = searchTools(toolGroups(tools), query)
  const searching = query.trim() !== ''

  function handleToggle(label: string): void {
    setToolGroupOpen(label, openGroups[label] !== true)
  }

  function handleQueryChange(event: React.ChangeEvent<HTMLInputElement>): void {
    setQuery(event.target.value)
  }

  function handleAdd(tool: ToolEntry): void {
    setError(onAdd(tool) ?? null)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative shrink-0 p-4 pb-2">
        <RiSearchLine
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-7 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id={searchId}
          type="search"
          aria-label="Search tools"
          placeholder="Search tools"
          className="pl-9"
          value={query}
          onChange={handleQueryChange}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
        {before}
        {error && (
          <p role="alert" className="text-body-md text-destructive">
            {error}
          </p>
        )}
        {groups.length === 0 && (
          <p role="status" className="text-body-md text-muted-foreground">
            No tools match “{query.trim()}”.
          </p>
        )}
        {groups.map((group) => (
          <ToolGroupList
            key={group.label}
            label={group.label}
            tools={group.tools}
            open={searching || openGroups[group.label] === true}
            onToggle={handleToggle}
            onAdd={handleAdd}
          />
        ))}
      </div>
    </div>
  )
}

/** Every editing tool for a document. Choosing one adds it as a step after the selected step, or at the end. */
export function ToolsBrowser({
  documentId,
  tools,
  catalogues,
}: ToolsBrowserProps): React.JSX.Element {
  const handleAdd = useCallback(
    (tool: ToolEntry): string | undefined =>
      addTool(documentId, tool, catalogues),
    [documentId, catalogues],
  )

  return <ToolsList tools={tools} onAdd={handleAdd} />
}
