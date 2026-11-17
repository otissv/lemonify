import { useNavigate, useRouter, getRouteApi } from '@tanstack/react-router'
import { useCallback } from 'react'

import {
  Menubar,
  MenubarContent,
  MenubarLabel,
  MenubarMenu,
  MenubarItem,
  MenubarSeparator,
  MenubarTrigger,
} from '@/components/ui/menubar'
import { signOut } from '@/features/auth/auth-client'
import {
  ActionCheckboxItem,
  ActionMenuItem,
} from '@/features/keybindings/action-menu-items'
import { useActionContext } from '@/features/keybindings/use-action-context'
import { useAppStore } from '@/store/app-store'

const rootRoute = getRouteApi('__root__')

const PANEL_ITEMS: ReadonlyArray<{ actionId: string; label: string }> = [
  { actionId: 'panel.tools', label: 'Tools' },
  { actionId: 'panel.options', label: 'Options' },
  { actionId: 'panel.export', label: 'Export' },
  { actionId: 'panel.results', label: 'Results' },
]

interface AppMenuBarProps {
  /** The document the edit and panel items act on; none on pages without one. */
  documentId?: string
}

/**
 * The application's menu: opening images, editing, the view and the account.
 * It sits at the top of the floating panel, so the page has no header of its
 * own and the image can fill the space. Each item does an action through the
 * same code as its key, and shows the key the User has for it.
 */
export function AppMenuBar({ documentId }: AppMenuBarProps): React.JSX.Element {
  const router = useRouter()
  const navigate = useNavigate()
  const { actor } = rootRoute.useRouteContext()
  const context = useActionContext(documentId)
  const showOriginal = useAppStore((state) =>
    documentId === undefined
      ? false
      : (state.showOriginal[documentId] ?? false),
  )
  const sidebarOpen = useAppStore((state) => state.sidebarOpen)

  const handleSignOut = useCallback((): void => {
    void (async () => {
      await signOut()
      await router.invalidate()
      await navigate({ to: '/sign-in' })
    })()
  }, [router, navigate])

  return (
    <div className="flex min-w-0 flex-col">
      <Menubar aria-label="Application">
        <MenubarMenu>
          <MenubarTrigger>File</MenubarTrigger>
          <MenubarContent>
            <ActionMenuItem actionId="file.openImage" context={context} />
            <ActionMenuItem actionId="file.openLibrary" context={context} />
            <ActionMenuItem
              actionId="file.importDocument"
              context={context}
              label="Import document…"
            />
            {documentId !== undefined && (
              <>
                <MenubarSeparator />
                <ActionMenuItem actionId="file.exportImage" context={context} />
                <ActionMenuItem
                  actionId="file.exportDocument"
                  context={context}
                  label="Export document…"
                />
              </>
            )}
            <MenubarSeparator />
            <ActionMenuItem actionId="file.close" context={context} />
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger>Edit</MenubarTrigger>
          <MenubarContent>
            <ActionMenuItem actionId="edit.undo" context={context} />
            <ActionMenuItem actionId="edit.redo" context={context} />
            <MenubarSeparator />
            <ActionMenuItem actionId="edit.insertImage" context={context} />
            <ActionMenuItem actionId="edit.replaceImage" context={context} />
            <MenubarSeparator />
            <ActionCheckboxItem
              actionId="edit.showOriginal"
              context={context}
              checked={showOriginal}
            />
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger>View</MenubarTrigger>
          <MenubarContent>
            {documentId !== undefined &&
              PANEL_ITEMS.map(({ actionId, label }) => (
                <ActionMenuItem
                  key={actionId}
                  actionId={actionId}
                  context={context}
                  label={label}
                />
              ))}
            {documentId !== undefined && <MenubarSeparator />}
            <ActionCheckboxItem
              actionId="view.sidebar"
              context={context}
              label="Sidebar"
              checked={sidebarOpen}
            />
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger>Help</MenubarTrigger>
          <MenubarContent>
            <ActionMenuItem
              actionId="help.shortcuts"
              context={context}
              label="Keyboard shortcuts…"
            />
          </MenubarContent>
        </MenubarMenu>
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
