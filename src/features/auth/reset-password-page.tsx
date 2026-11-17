import { useRouter } from '@tanstack/react-router'
import { useCallback } from 'react'

import { resetPassword } from '@/features/auth/auth-client'
import { ResetPasswordForm } from '@/features/auth/reset-password-form'
import { SIGN_IN_PATH } from '@/features/app/session-guard'

export type ResetPasswordPageProps = {
  /** From the link in the email; Better Auth sends `error` instead when the link is no good. */
  token: string | undefined
  error: string | undefined
}

export function ResetPasswordPage({
  token,
  error,
}: ResetPasswordPageProps): React.JSX.Element {
  const router = useRouter()

  const handleReset = useCallback(
    async (newPassword: string): Promise<string | null> => {
      if (token === undefined) return null
      return (await resetPassword(token, newPassword)).error
    },
    [token],
  )

  const handleDone = useCallback((): void => {
    void router.navigate({ to: SIGN_IN_PATH })
  }, [router])

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <ResetPasswordForm
        linkIsValid={token !== undefined && error === undefined}
        onReset={handleReset}
        onDone={handleDone}
      />
    </main>
  )
}
