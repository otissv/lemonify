import { AppMenuBar } from '@/features/app/app-menu-bar'
import { FloatingPanel } from '@/features/tools/floating-panel'

/** The floating panel of a page with no document: just the application menu. */
export function MenuPanel(): React.JSX.Element {
  return <FloatingPanel label="Menu" className="w-80" menu={<AppMenuBar />} />
}
