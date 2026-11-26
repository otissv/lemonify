import { Outlet, getRouteApi } from '@tanstack/react-router'

import { AppLayout } from '@/features/app/app-layout'
import { ItemNamesProvider } from '@/features/documents/item-names'

const rootRoute = getRouteApi('__root__')

/** The app shell for a signed-in User; the sign-in page stands alone. */
export function RootLayout(): React.JSX.Element {
  const { actor } = rootRoute.useRouteContext()
  if (actor === null) return <Outlet />
  return (
    <ItemNamesProvider>
      <AppLayout />
    </ItemNamesProvider>
  )
}
