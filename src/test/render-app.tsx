import { render } from '@testing-library/react'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import type { AnyRouter } from '@tanstack/react-router'

import { loadAppData } from '@/features/app/load-app-data'
import { RootLayout } from '@/features/app/root-layout'
import { guardSession } from '@/features/app/session-guard'
import { DocumentPage } from '@/features/documents/document-page'
import { HomePage } from '@/features/app/home-page'
import { AI_CATALOGUES, AI_TOOLS_OFFERED } from '@/test/document-fixtures'
import { WorkflowPage } from '@/features/workflows/workflow-page'
import type { Actor } from '@/server/domain/actor'

export const TEST_ACTOR: Actor = { userId: 'user-1', name: 'Ann' }

let sessionActor: Actor | null = TEST_ACTOR

const rootRoute = createRootRoute({
  beforeLoad: ({ location }) => {
    guardSession(sessionActor, location.pathname)
    return { actor: sessionActor }
  },
  loader: ({ context }) =>
    context.actor === null ? { documents: [], workflows: [] } : loadAppData(),
  component: RootLayout,
})

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign-in',
  component: () => <h1>Sign in page</h1>,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
})

const documentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/documents/$id',
  component: DocumentRoutePage,
})

function DocumentRoutePage(): React.JSX.Element {
  const { id } = documentRoute.useParams()
  return (
    <DocumentPage id={id} tools={AI_TOOLS_OFFERED} catalogues={AI_CATALOGUES} />
  )
}

const workflowRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workflows/$id',
  component: WorkflowRoutePage,
})

function WorkflowRoutePage(): React.JSX.Element {
  const { id } = workflowRoute.useParams()
  return <WorkflowPage id={id} aiTools={[]} />
}

/** Renders the app layout and pages in a memory router, like the real route tree. */
export async function renderApp(
  path = '/',
  actor: Actor | null = TEST_ACTOR,
): Promise<{ router: AnyRouter }> {
  sessionActor = actor
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      indexRoute,
      documentRoute,
      workflowRoute,
      signInRoute,
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  await router.load()
  render(<RouterProvider router={router} />)
  return { router }
}
