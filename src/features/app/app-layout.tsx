import { Outlet, useRouterState } from '@tanstack/react-router'
import { useEffect } from 'react'

import { AppSidebar } from '@/features/app/app-sidebar'
import { ImageOpenerProvider } from '@/features/app/image-opener'
import { NewDocumentDialog } from '@/features/documents/new-document-dialog'
import { KeybindingsProvider } from '@/features/keybindings/keybindings-context'
import { KeyBindings } from '@/features/keybindings/key-bindings'
import { ShortcutsDialog } from '@/features/keybindings/shortcuts-dialog'
import { MenuPanel } from '@/features/app/menu-panel'
import { LiveStatus } from '@/features/realtime/live-status'
import { useRealtime } from '@/features/realtime/use-realtime'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { useUiStore } from '@/store/ui-store'

/** Pages that bring their own floating panel. */
const PANEL_PATHS = ['/documents/', '/workflows/']

/**
 * The shell has no header: everything the header held lives in the menu of the
 * floating panel, so the page fills the whole area. A document page and a workflow
 * page bring their own panel; every other page gets one holding just the menu.
 */
export function AppLayout(): React.JSX.Element {
  const sidebarOpen = useUiStore((state) => state.sidebarOpen)
  const setSidebarOpen = useUiStore((state) => state.setSidebarOpen)
  const ownsPanel = useRouterState({
    select: (state) =>
      PANEL_PATHS.some((path) => state.location.pathname.startsWith(path)),
  })

  useRealtime()

  useEffect(() => {
    void useUiStore.persist.rehydrate()
  }, [])

  return (
    <KeybindingsProvider>
      <ImageOpenerProvider>
        <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SidebarInset className="h-svh">
            <main className="relative min-h-0 flex-1 overflow-hidden">
              <Outlet />
              {ownsPanel ? null : <MenuPanel />}
              {ownsPanel ? null : <KeyBindings />}
              <LiveStatus />
            </main>
          </SidebarInset>
          <AppSidebar />
          <ShortcutsDialog />
          <NewDocumentDialog />
        </SidebarProvider>
      </ImageOpenerProvider>
    </KeybindingsProvider>
  )
}
