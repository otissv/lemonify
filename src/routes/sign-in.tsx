import { createFileRoute } from '@tanstack/react-router'

import { getAuthOptions } from '@/features/auth/auth-options'
import { SignInPage } from '@/features/auth/sign-in-page'

export const Route = createFileRoute('/sign-in')({
  loader: () => getAuthOptions(),
  component: SignInRoute,
})

function SignInRoute(): React.JSX.Element {
  const { emailEnabled } = Route.useLoaderData()
  return <SignInPage emailEnabled={emailEnabled} />
}
