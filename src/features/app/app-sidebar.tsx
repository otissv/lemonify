import {
  RiArrowDownSLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiDeleteBinLine,
  RiFlowChart,
  RiImageLine,
  RiSearchLine,
} from '@remixicon/react'
import {
  Link,
  getRouteApi,
  useNavigate,
  useParams,
  useRouter,
} from '@tanstack/react-router'
import { useState } from 'react'

import { AddWorkflowDialog } from '@/features/workflows/add-workflow-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { filterByQuery } from '@/features/app/sidebar-search'
import type { DocumentSummary } from '@/features/documents/document'
import {
  deleteDocument,
  renameDocument,
} from '@/features/documents/document-functions'
import { DocumentNameInput } from '@/features/app/document-name-input'
import { DocumentSteps } from '@/features/documents/document-steps'
import { errorMessage } from '@/lib/error-message'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SidebarTab, useAppStore } from '@/store/app-store'

const rootRoute = getRouteApi('__root__')
const DELETE_FAILED = 'The image could not be deleted.'
const RENAME_FAILED = 'The image could not be renamed.'

const TAB_LABELS: Readonly<Record<SidebarTab, string>> = {
  [SidebarTab.Editor]: 'Editor',
  [SidebarTab.Workflow]: 'Workflow',
}

function isSidebarTab(value: string): value is SidebarTab {
  return Object.values<string>(SidebarTab).includes(value)
}

/** Hover is darker than the row's active background, which now sits behind these buttons. */
const ROW_BUTTON_CLASS = 'group-data-[active=true]/row:hover:bg-black/25'

function DocumentItem({
  document,
  active,
}: {
  document: DocumentSummary
  active: boolean
}): React.JSX.Element {
  const navigate = useNavigate()
  const router = useRouter()
  const expanded = useAppStore(
    (state) => state.expandedDocuments[document.id] ?? false,
  )
  const setExpanded = useAppStore((state) => state.setDocumentExpanded)
  const forgetDocument = useAppStore((state) => state.forgetDocument)
  const confirmDocument = useAppStore((state) => state.confirmDocument)
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)

  function handleToggle(): void {
    setExpanded(document.id, !expanded)
  }

  function handleStartRename(): void {
    setError(null)
    setRenaming(true)
  }

  function handleRenameKey(event: React.KeyboardEvent<HTMLElement>): void {
    if (event.key !== 'F2') return
    event.preventDefault()
    handleStartRename()
  }

  function handleCancelRename(): void {
    setRenaming(false)
  }

  async function handleRename(name: string): Promise<void> {
    setRenaming(false)
    try {
      await renameDocument({ data: { id: document.id, name } })
      const session = useAppStore.getState().documents[document.id]
      if (session) confirmDocument({ ...session.confirmed, name }, false)
      await router.invalidate()
    } catch (caught) {
      setError(errorMessage(caught, RENAME_FAILED))
    }
  }

  async function handleDelete(): Promise<void> {
    setError(null)
    try {
      await deleteDocument({ data: { id: document.id } })
      forgetDocument(document.id)
      await router.invalidate()
      if (active) await navigate({ to: '/' })
    } catch (caught) {
      setError(errorMessage(caught, DELETE_FAILED))
    }
  }

  return (
    <SidebarMenuItem>
      <div
        data-active={active}
        className="group/row flex items-center gap-1 rounded-md data-[active=true]:bg-sidebar-accent"
      >
        <Button
          variant="ghost"
          size="icon-xs"
          className={ROW_BUTTON_CLASS}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Hide' : 'Show'} steps of ${document.name}`}
          onClick={handleToggle}
        >
          {expanded ? (
            <RiArrowDownSLine aria-hidden="true" />
          ) : (
            <RiArrowRightSLine aria-hidden="true" />
          )}
        </Button>
        {renaming ? (
          <DocumentNameInput
            name={document.name}
            onCommit={(name) => void handleRename(name)}
            onCancel={handleCancelRename}
          />
        ) : (
          <SidebarMenuButton
            asChild
            isActive={active}
            className="flex-1 text-foreground hover:text-foreground data-[active=true]:bg-transparent"
          >
            <Link
              to="/documents/$id"
              params={{ id: document.id }}
              title={document.source?.fileName}
              onClick={handleToggle}
              onDoubleClick={handleStartRename}
              onKeyDown={handleRenameKey}
            >
              <RiImageLine aria-hidden="true" />
              <span className="truncate">{document.name}</span>
            </Link>
          </SidebarMenuButton>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          className={ROW_BUTTON_CLASS}
          aria-label={`Delete ${document.name}`}
          onClick={() => void handleDelete()}
        >
          <RiDeleteBinLine aria-hidden="true" />
        </Button>
      </div>
      {error && (
        <p role="alert" className="px-2 text-caption text-destructive">
          {error}
        </p>
      )}
      {expanded && (
        <DocumentSteps documentId={document.id} name={document.name} />
      )}
    </SidebarMenuItem>
  )
}

function DocumentList({ query }: { query: string }): React.JSX.Element | null {
  const { documents } = rootRoute.useLoaderData()
  const { id: activeId } = useParams({ strict: false })
  if (documents.length === 0) return null
  const shown = filterByQuery(documents, query, (document) => [
    document.name,
    document.source?.fileName ?? '',
  ])

  if (shown.length === 0) {
    return (
      <p role="status" className="px-2 text-body-md text-muted-foreground">
        No images match “{query.trim()}”.
      </p>
    )
  }

  return (
    <SidebarMenu aria-label="Open images">
      {shown.map((document) => (
        <DocumentItem
          key={document.id}
          document={document}
          active={document.id === activeId}
        />
      ))}
    </SidebarMenu>
  )
}

function SidebarSearch({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}): React.JSX.Element {
  function handleChange(event: React.ChangeEvent<HTMLInputElement>): void {
    onChange(event.target.value)
  }

  return (
    <div className="relative px-2">
      <RiSearchLine
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        aria-label={label}
        placeholder={label}
        className="pl-8"
        value={value}
        onChange={handleChange}
      />
    </div>
  )
}

function EditorTab(): React.JSX.Element {
  const { documents } = rootRoute.useLoaderData()
  const [query, setQuery] = useState('')

  return (
    <SidebarGroup className="gap-3 px-2 py-4">
      {documents.length > 0 && (
        <SidebarSearch
          label="Search images"
          value={query}
          onChange={setQuery}
        />
      )}
      <DocumentList query={query} />
    </SidebarGroup>
  )
}

function WorkflowList({ query }: { query: string }): React.JSX.Element {
  const { workflows } = rootRoute.useLoaderData()
  const { id: activeId } = useParams({ strict: false })

  if (workflows.length === 0) {
    return (
      <p role="status" className="px-2 text-body-md text-muted-foreground">
        No workflows yet.
      </p>
    )
  }

  const shown = filterByQuery(workflows, query, (workflow) => [workflow.name])

  if (shown.length === 0) {
    return (
      <p role="status" className="px-2 text-body-md text-muted-foreground">
        No workflows match “{query.trim()}”.
      </p>
    )
  }

  return (
    <SidebarMenu aria-label="Workflows">
      {shown.map((workflow) => (
        <SidebarMenuItem key={workflow.id}>
          <SidebarMenuButton
            asChild
            isActive={workflow.id === activeId}
            className="text-foreground hover:text-foreground"
          >
            <Link to="/workflows/$id" params={{ id: workflow.id }}>
              <RiFlowChart aria-hidden="true" />
              <span className="truncate">{workflow.name}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  )
}

function WorkflowTab(): React.JSX.Element {
  const { workflows } = rootRoute.useLoaderData()
  const [query, setQuery] = useState('')

  return (
    <>
      <SidebarGroup className="p-4">
        <AddWorkflowDialog />
      </SidebarGroup>
      <SidebarGroup className="gap-3 px-2 py-0">
        {workflows.length > 0 && (
          <SidebarSearch
            label="Search workflows"
            value={query}
            onChange={setQuery}
          />
        )}
        <WorkflowList query={query} />
      </SidebarGroup>
    </>
  )
}

/**
 * A small tab on the sidebar's outer edge that collapses it, and brings it
 * back when it is collapsed: the tab rides out with the sidebar, so it stays
 * at the edge of the window. The sidebar has no header to hold a button.
 */
function SidebarEdgeToggle(): React.JSX.Element {
  const { open, toggleSidebar } = useSidebar()
  const Icon = open ? RiArrowRightSLine : RiArrowLeftSLine

  return (
    <button
      type="button"
      aria-label={open ? 'Hide sidebar' : 'Show sidebar'}
      aria-expanded={open}
      className="absolute top-3 right-full flex size-8 items-center justify-center rounded-l-md border border-r-0 border-sidebar-border bg-sidebar text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      onClick={toggleSidebar}
    >
      <Icon aria-hidden="true" className="size-4" />
    </button>
  )
}

export function AppSidebar(): React.JSX.Element {
  const tab = useAppStore((state) => state.sidebarTab)
  const setTab = useAppStore((state) => state.setSidebarTab)

  function handleTabChange(value: string): void {
    if (isSidebarTab(value)) setTab(value)
  }

  return (
    <Sidebar side="right" collapsible="offcanvas">
      <Tabs
        value={tab}
        onValueChange={handleTabChange}
        className="min-h-0 flex-1 gap-0"
      >
        <div className="flex h-16 shrink-0 items-center px-4">
          <TabsList className="w-full">
            {Object.values(SidebarTab).map((value) => (
              <TabsTrigger key={value} value={value}>
                {TAB_LABELS[value]}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <SidebarContent>
          <TabsContent value={SidebarTab.Editor}>
            <EditorTab />
          </TabsContent>
          <TabsContent value={SidebarTab.Workflow}>
            <WorkflowTab />
          </TabsContent>
        </SidebarContent>
      </Tabs>
      <SidebarEdgeToggle />
      <SidebarRail aria-hidden="true" />
    </Sidebar>
  )
}
