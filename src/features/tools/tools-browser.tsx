import { RiAddLine, RiArrowDownSLine, RiSearchLine } from '@remixicon/react'
import { useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { catalogueFor, createAiStepFor } from '@/features/ai/ai-defaults'
import type { AiCatalogues } from '@/features/ai/ai-defaults'
import type { AiToolSummary } from '@/features/ai/ai-tools'
import { createSharpStep, createSourceStep } from '@/features/pipeline/pipeline'
import { addStepAfter } from '@/features/pipeline/pipeline-actions'
import { searchTools, toolGroups } from '@/features/tools/tool-catalogue'
import { ImagePicker } from '@/features/workflows/fields/image-picker'
import type { ToolEntry } from '@/features/tools/tool-catalogue'
import { errorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'

interface ToolsBrowserProps {
  documentId: string
  tools: ReadonlyArray<AiToolSummary>
  catalogues: AiCatalogues
}

interface ToolGroupProps {
  label: string
  tools: ReadonlyArray<ToolEntry>
  open: boolean
  onToggle: (label: string) => void
  onAdd: (tool: ToolEntry) => void
}

const NO_CATALOGUE = 'That AI tool is not available right now.'

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
          <li key={tool.value}>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Add ${tool.label}`}
              className="w-full justify-start gap-2 px-2"
              onClick={() => {
                onAdd(tool)
              }}
            >
              <RiAddLine aria-hidden="true" />
              {tool.label}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Every editing tool, grouped and searchable. Choosing one adds it as a step after the selected step, or at the end. */
export function ToolsBrowser({
  documentId,
  tools,
  catalogues,
}: ToolsBrowserProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [choosingImage, setChoosingImage] = useState(false)
  const searchId = useId()
  const groups = searchTools(toolGroups(tools), query)
  const searching = query.trim() !== ''

  function handleToggle(label: string): void {
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(label)) next.add(label)
      return next
    })
  }

  function handleQueryChange(event: React.ChangeEvent<HTMLInputElement>): void {
    setQuery(event.target.value)
  }

  function handleOpenImage(sourceId: string): void {
    const afterId = useAppStore.getState().selectedSteps[documentId]
    addStepAfter(documentId, createSourceStep(sourceId), afterId)
    setChoosingImage(false)
  }

  function handleAdd(tool: ToolEntry): void {
    setError(null)
    const afterId = useAppStore.getState().selectedSteps[documentId]
    if (tool.kind === 'source') {
      setChoosingImage((current) => !current)
      return
    }
    if (tool.kind === 'sharp') {
      addStepAfter(documentId, createSharpStep(tool.value), afterId)
      return
    }
    const catalogue = catalogueFor(catalogues, tool.value)
    if (catalogue === undefined) {
      setError(NO_CATALOGUE)
      return
    }
    try {
      addStepAfter(documentId, createAiStepFor(tool.value, catalogue), afterId)
    } catch (caught) {
      setError(errorMessage(caught, NO_CATALOGUE))
    }
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
        {error && (
          <p role="alert" className="text-body-md text-destructive">
            {error}
          </p>
        )}
        {choosingImage && (
          <ImagePicker label="image" onPick={handleOpenImage} />
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
            open={searching || expanded.has(group.label)}
            onToggle={handleToggle}
            onAdd={handleAdd}
          />
        ))}
      </div>
    </div>
  )
}
