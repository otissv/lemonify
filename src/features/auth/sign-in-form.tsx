import { useCallback, useId, useState } from 'react'
import type { FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const AuthMode = {
  SignIn: 'sign-in',
  SignUp: 'sign-up',
} as const

export type AuthMode = (typeof AuthMode)[keyof typeof AuthMode]

export type SignInFormProps = {
  onSignIn: (email: string, password: string) => Promise<string | null>
  onSignUp: (
    name: string,
    email: string,
    password: string,
  ) => Promise<string | null>
}

const COPY = {
  [AuthMode.SignIn]: {
    title: 'Sign in',
    submit: 'Sign in',
    switchText: 'New here?',
    switchAction: 'Create an account',
  },
  [AuthMode.SignUp]: {
    title: 'Create an account',
    submit: 'Create account',
    switchText: 'Already have an account?',
    switchAction: 'Sign in',
  },
} as const

export function SignInForm({
  onSignIn,
  onSignUp,
}: SignInFormProps): React.JSX.Element {
  const [mode, setMode] = useState<AuthMode>(AuthMode.SignIn)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ids = { name: useId(), email: useId(), password: useId() }
  const copy = COPY[mode]

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault()
      setBusy(true)
      setError(null)
      try {
        const message =
          mode === AuthMode.SignIn
            ? await onSignIn(email, password)
            : await onSignUp(name, email, password)
        if (message !== null) setError(message)
      } finally {
        setBusy(false)
      }
    },
    [mode, name, email, password, onSignIn, onSignUp],
  )

  const handleSwitch = useCallback((): void => {
    setMode((current) =>
      current === AuthMode.SignIn ? AuthMode.SignUp : AuthMode.SignIn,
    )
    setError(null)
  }, [])

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={busy}
      className="flex w-full max-w-sm flex-col gap-4"
    >
      <h1 className="text-heading-md">{copy.title}</h1>
      {mode === AuthMode.SignUp ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={ids.name}>Name</Label>
          <Input
            id={ids.name}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            required
          />
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor={ids.email}>Email</Label>
        <Input
          id={ids.email}
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          required
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={ids.password}>Password</Label>
        <Input
          id={ids.password}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={
            mode === AuthMode.SignIn ? 'current-password' : 'new-password'
          }
          minLength={mode === AuthMode.SignUp ? 8 : undefined}
          required
        />
      </div>
      {error === null ? null : (
        <p role="alert" className="text-body-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy}>
        {copy.submit}
      </Button>
      <p className="text-body-sm text-muted-foreground">
        {copy.switchText}{' '}
        <button
          type="button"
          onClick={handleSwitch}
          className="underline underline-offset-4"
        >
          {copy.switchAction}
        </button>
      </p>
    </form>
  )
}
