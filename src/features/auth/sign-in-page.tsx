import { useRouter } from '@tanstack/react-router'
import { useCallback } from 'react'

import {
  requestPasswordReset,
  resendVerificationEmail,
  signInWithEmail,
  signUpWithEmail,
} from '@/features/auth/auth-client'
import { SignInForm } from '@/features/auth/sign-in-form'
import type { SignInOutcome, SignUpOutcome } from '@/features/auth/sign-in-form'

export type SignInPageProps = {
  emailEnabled: boolean
}

export function SignInPage({
  emailEnabled,
}: SignInPageProps): React.JSX.Element {
  const router = useRouter()

  const enter = useCallback(async (): Promise<void> => {
    await router.invalidate()
    await router.navigate({ to: '/' })
  }, [router])

  const handleSignIn = useCallback(
    async (email: string, password: string): Promise<SignInOutcome> => {
      const result = await signInWithEmail(email, password)
      if (result.error === null) await enter()
      return result
    },
    [enter],
  )

  const handleSignUp = useCallback(
    async (
      name: string,
      email: string,
      password: string,
    ): Promise<SignUpOutcome> => {
      const result = await signUpWithEmail(name, email, password)
      if (result.error === null && !result.confirmEmail) await enter()
      return result
    },
    [enter],
  )

  const handleForgotPassword = useCallback(
    async (email: string): Promise<string | null> =>
      (await requestPasswordReset(email)).error,
    [],
  )

  const handleResendVerification = useCallback(
    async (email: string): Promise<string | null> =>
      (await resendVerificationEmail(email)).error,
    [],
  )

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <SignInForm
        emailEnabled={emailEnabled}
        onSignIn={handleSignIn}
        onSignUp={handleSignUp}
        onForgotPassword={handleForgotPassword}
        onResendVerification={handleResendVerification}
      />
    </main>
  )
}
