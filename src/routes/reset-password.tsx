import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { ResetPasswordPage } from '@/features/auth/reset-password-page'

const SearchSchema = z.object({
  token: z.string().min(1).optional().catch(undefined),
  error: z.string().min(1).optional().catch(undefined),
})

export const Route = createFileRoute('/reset-password')({
  validateSearch: SearchSchema,
  component: ResetPasswordRoute,
})

function ResetPasswordRoute(): React.JSX.Element {
  const { token, error } = Route.useSearch()
  return <ResetPasswordPage token={token} error={error} />
}
