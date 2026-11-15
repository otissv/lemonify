import { Outlet, getRouteApi } from '@tanstack/react-router'

import { AppLayout } from '@/features/app/app-layout'

const rootRoute = getRouteApi('__root__')

/** The app shell for a signed-in User; the sign-in page stands alone. */
export function RootLayout(): React.JSX.Element {
  const { actor } = rootRoute.useRouteContext()
  return actor === null ? <Outlet /> : <AppLayout />
}
