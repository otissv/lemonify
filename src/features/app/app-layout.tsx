import { Outlet, useRouterState } from '@tanstack/react-router'
import { useEffect } from 'react'

import { AppSidebar } from '@/features/app/app-sidebar'
import { ImageOpenerProvider } from '@/features/app/image-opener'
import { MenuPanel } from '@/features/app/menu-panel'
import { LiveStatus } from '@/features/realtime/live-status'
import { useRealtime } from '@/features/realtime/use-realtime'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { useAppStore } from '@/store/app-store'

const DOCUMENT_PATH = '/documents/'

/**
 * The shell has no header: everything the header held lives in the menu of the
 * floating panel, so the page fills the whole area. A document page brings its
 * own panel; every other page gets one holding just the menu.
 */
export function AppLayout(): React.JSX.Element {
  const sidebarOpen = useAppStore((state) => state.sidebarOpen)
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen)
  const onDocument = useRouterState({
    select: (state) => state.location.pathname.startsWith(DOCUMENT_PATH),
  })

  useRealtime()

  useEffect(() => {
    void useAppStore.persist.rehydrate()
  }, [])

  return (
    <ImageOpenerProvider>
      <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SidebarInset className="h-svh">
          <main className="relative min-h-0 flex-1 overflow-hidden">
            <Outlet />
            {onDocument ? null : <MenuPanel />}
            <LiveStatus />
          </main>
        </SidebarInset>
        <AppSidebar />
      </SidebarProvider>
    </ImageOpenerProvider>
  )
}
