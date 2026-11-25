import { useNavigate, useRouter, getRouteApi } from '@tanstack/react-router'
import { useCallback } from 'react'

import {
  Menubar,
  MenubarContent,
  MenubarLabel,
  MenubarMenu,
  MenubarItem,
  MenubarTrigger,
} from '@/components/ui/menubar'
import { signOut } from '@/features/auth/auth-client'
import { ActionMenu } from '@/features/keybindings/action-menu-items'
import type { ActionMenuEntry } from '@/features/keybindings/action-menu-items'
import { Page } from '@/features/keybindings/actions'
import { useActionContext } from '@/features/keybindings/use-action-context'
import { SidePanelTab, useUiStore } from '@/store/ui-store'

const rootRoute = getRouteApi('__root__')

type Sections = ReadonlyArray<ReadonlyArray<ActionMenuEntry>>

const FILE_SECTIONS: Sections = [
  [
    { actionId: 'file.newDocument', label: 'New document…' },
    { actionId: 'file.openImage' },
    { actionId: 'file.openLibrary' },
    { actionId: 'file.importDocument', label: 'Import document…' },
  ],
  [
    { actionId: 'file.exportImage' },
    { actionId: 'file.exportDocument', label: 'Export document…' },
  ],
  [{ actionId: 'file.close' }],
]

const PANEL_SECTION: ReadonlyArray<ActionMenuEntry> = [
  { actionId: 'panel.tools', label: 'Tools' },
  { actionId: 'panel.options', label: 'Options' },
  { actionId: 'panel.export', label: 'Export' },
  { actionId: 'panel.results', label: 'Results' },
]

const HELP_SECTIONS: Sections = [
  [{ actionId: 'help.shortcuts', label: 'Keyboard shortcuts…' }],
]

interface AppMenuBarProps {
  /** The document the edit and panel items act on; none on pages without one. */
  documentId?: string
  /** The workflow whose page this is; its menu offers what applies to a workflow. */
  workflowId?: string
}

function pageOf(props: AppMenuBarProps): Page {
  if (props.documentId !== undefined) return Page.Document
  if (props.workflowId !== undefined) return Page.Workflow
  return Page.Home
}

/**
 * The application's menu: opening images, editing, the view and the account.
 * It sits at the top of the floating panel, so the page has no header of its
 * own and the image can fill the space. Each item does an action through the
 * same code as its key and shows the key the User has for it, and only the
 * actions that apply on the page are offered.
 */
export function AppMenuBar(props: AppMenuBarProps): React.JSX.Element {
  const { documentId, workflowId } = props
  const router = useRouter()
  const navigate = useNavigate()
  const { actor } = rootRoute.useRouteContext()
  const context = useActionContext(pageOf(props), documentId ?? workflowId)
  const showOriginal = useUiStore((state) =>
    documentId === undefined
      ? false
      : (state.showOriginal[documentId] ?? false),
  )
  const sidebarOpen = useUiStore((state) => state.sidebarOpen)
  const sidePanelTab = useUiStore((state) =>
    state.workflowSidePanelOpen ? state.workflowSidePanelTab : undefined,
  )

  const handleSignOut = useCallback((): void => {
    void (async () => {
      await signOut()
      await router.invalidate()
      await navigate({ to: '/sign-in' })
    })()
  }, [router, navigate])

  const editSections: Sections = [
    [{ actionId: 'edit.undo' }, { actionId: 'edit.redo' }],
    [
      { actionId: 'edit.addImageLayer' },
      { actionId: 'edit.insertImage' },
      { actionId: 'edit.replaceImage' },
    ],
    [{ actionId: 'edit.setCanvas', label: 'Canvas size…' }],
    [{ actionId: 'edit.showOriginal', checked: showOriginal }],
  ]
  const viewSections: Sections = [
    PANEL_SECTION,
    [
      { actionId: 'view.sidebar', label: 'Sidebar', checked: sidebarOpen },
      {
        actionId: 'view.stepPreview',
        label: 'Step preview',
        checked: sidePanelTab === SidePanelTab.Preview,
      },
      {
        actionId: 'view.runPanel',
        label: 'Run panel',
        checked: sidePanelTab === SidePanelTab.Runs,
      },
    ],
  ]

  return (
    <div className="flex min-w-0 flex-col">
      <Menubar aria-label="Application">
        <ActionMenu title="File" context={context} sections={FILE_SECTIONS} />
        <ActionMenu title="Edit" context={context} sections={editSections} />
        <ActionMenu title="View" context={context} sections={viewSections} />
        <ActionMenu title="Help" context={context} sections={HELP_SECTIONS} />
        <MenubarMenu>
          <MenubarTrigger>Account</MenubarTrigger>
          <MenubarContent>
            {actor !== null && <MenubarLabel>{actor.name}</MenubarLabel>}
            <MenubarItem onSelect={handleSignOut}>Sign out</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
    </div>
  )
}
