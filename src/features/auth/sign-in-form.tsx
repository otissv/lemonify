import { useCallback, useId, useState } from 'react'
import type { FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MIN_PASSWORD_LENGTH } from '@/features/auth/password-rules'

export const AuthMode = {
  SignIn: 'sign-in',
  SignUp: 'sign-up',
  Forgot: 'forgot',
} as const

export type AuthMode = (typeof AuthMode)[keyof typeof AuthMode]

export type SignInOutcome = { error: string | null; unverified?: boolean }
export type SignUpOutcome = { error: string | null; confirmEmail?: boolean }

export type SignInFormProps = {
  /** Whether the server can send email, which turns on confirming addresses and resetting passwords. */
  emailEnabled: boolean
  onSignIn: (email: string, password: string) => Promise<SignInOutcome>
  onSignUp: (
    name: string,
    email: string,
    password: string,
  ) => Promise<SignUpOutcome>
  /** Resolves to a reason when it could not be asked for, else null. */
  onForgotPassword: (email: string) => Promise<string | null>
  onResendVerification: (email: string) => Promise<string | null>
}

const COPY = {
  [AuthMode.SignIn]: { title: 'Sign in', submit: 'Sign in' },
  [AuthMode.SignUp]: { title: 'Create an account', submit: 'Create account' },
  [AuthMode.Forgot]: {
    title: 'Reset your password',
    submit: 'Send reset link',
  },
} as const

const LINK_BUTTON = 'underline underline-offset-4'

type Notice = {
  text: string
  /** The form is replaced by the notice, with a way back. */
  replacesForm: boolean
}

export function SignInForm(props: SignInFormProps): React.JSX.Element {
  const { emailEnabled, onSignIn, onSignUp, onForgotPassword } = props
  const [mode, setMode] = useState<AuthMode>(AuthMode.SignIn)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [unverified, setUnverified] = useState(false)
  const [busy, setBusy] = useState(false)
  const ids = { name: useId(), email: useId(), password: useId() }
  const copy = COPY[mode]

  const goTo = useCallback((next: AuthMode): void => {
    setMode(next)
    setError(null)
    setNotice(null)
    setUnverified(false)
  }, [])

  const submit = useCallback(async (): Promise<void> => {
    if (mode === AuthMode.Forgot) {
      const reason = await onForgotPassword(email)
      if (reason !== null) return setError(reason)
      return setNotice({
        text: `If there is an account for ${email}, we sent a link to reset the password.`,
        replacesForm: true,
      })
    }
    if (mode === AuthMode.SignUp) {
      const outcome = await onSignUp(name, email, password)
      if (outcome.error !== null) return setError(outcome.error)
      if (outcome.confirmEmail === true) {
        return setNotice({
          text: `Check your email. We sent a link to ${email} to confirm your account.`,
          replacesForm: true,
        })
      }
      return
    }
    const outcome = await onSignIn(email, password)
    if (outcome.error !== null) setError(outcome.error)
    setUnverified(outcome.unverified === true)
  }, [mode, name, email, password, onSignIn, onSignUp, onForgotPassword])

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault()
      setBusy(true)
      setError(null)
      setNotice(null)
      try {
        await submit()
      } finally {
        setBusy(false)
      }
    },
    [submit],
  )

  const { onResendVerification } = props
  const handleResend = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      const reason = await onResendVerification(email)
      if (reason !== null) return setError(reason)
      setError(null)
      setNotice({
        text: `We sent a new link to ${email}.`,
        replacesForm: false,
      })
    } finally {
      setBusy(false)
    }
  }, [email, onResendVerification])

  if (notice?.replacesForm === true) {
    return (
      <div className="flex w-full max-w-sm flex-col gap-4">
        <h1 className="text-heading-md">{copy.title}</h1>
        <p role="status" className="text-body-md">
          {notice.text}
        </p>
        <Button type="button" onClick={() => goTo(AuthMode.SignIn)}>
          Back to sign in
        </Button>
      </div>
    )
  }

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
      {mode === AuthMode.Forgot ? null : (
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
            minLength={
              mode === AuthMode.SignUp ? MIN_PASSWORD_LENGTH : undefined
            }
            required
          />
        </div>
      )}
      {error === null ? null : (
        <p role="alert" className="text-body-sm text-destructive">
          {error}
        </p>
      )}
      {notice === null ? null : (
        <p role="status" className="text-body-sm">
          {notice.text}
        </p>
      )}
      {unverified ? (
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={handleResend}
        >
          Send the link again
        </Button>
      ) : null}
      <Button type="submit" disabled={busy}>
        {copy.submit}
      </Button>
      <FormLinks mode={mode} emailEnabled={emailEnabled} onGoTo={goTo} />
    </form>
  )
}

type FormLinksProps = {
  mode: AuthMode
  emailEnabled: boolean
  onGoTo: (mode: AuthMode) => void
}

function FormLinks({
  mode,
  emailEnabled,
  onGoTo,
}: FormLinksProps): React.JSX.Element {
  if (mode === AuthMode.Forgot) {
    return (
      <p className="text-body-sm text-muted-foreground">
        <button
          type="button"
          onClick={() => onGoTo(AuthMode.SignIn)}
          className={LINK_BUTTON}
        >
          Back to sign in
        </button>
      </p>
    )
  }
  const signingIn = mode === AuthMode.SignIn
  return (
    <div className="flex flex-col gap-2 text-body-sm text-muted-foreground">
      {signingIn && emailEnabled ? (
        <button
          type="button"
          onClick={() => onGoTo(AuthMode.Forgot)}
          className={`${LINK_BUTTON} self-start`}
        >
          Forgot your password?
        </button>
      ) : null}
      <p>
        {signingIn ? 'New here?' : 'Already have an account?'}{' '}
        <button
          type="button"
          onClick={() => onGoTo(signingIn ? AuthMode.SignUp : AuthMode.SignIn)}
          className={LINK_BUTTON}
        >
          {signingIn ? 'Create an account' : 'Sign in'}
        </button>
      </p>
    </div>
  )
}
