import { useRouter } from '@tanstack/react-router'
import { useCallback } from 'react'

import { signInWithEmail, signUpWithEmail } from '@/features/auth/auth-client'
import { SignInForm } from '@/features/auth/sign-in-form'

export function SignInPage(): React.JSX.Element {
  const router = useRouter()

  const finish = useCallback(
    async (error: string | null): Promise<string | null> => {
      if (error !== null) return error
      await router.invalidate()
      await router.navigate({ to: '/' })
      return null
    },
    [router],
  )

  const handleSignIn = useCallback(
    async (email: string, password: string): Promise<string | null> =>
      finish((await signInWithEmail(email, password)).error),
    [finish],
  )

  const handleSignUp = useCallback(
    async (
      name: string,
      email: string,
      password: string,
    ): Promise<string | null> =>
      finish((await signUpWithEmail(name, email, password)).error),
    [finish],
  )

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <SignInForm onSignIn={handleSignIn} onSignUp={handleSignUp} />
    </main>
  )
}
