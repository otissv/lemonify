import { useCallback, useId, useState } from 'react'
import type { FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MIN_PASSWORD_LENGTH } from '@/features/auth/password-rules'

export const MISMATCH = 'The two passwords are not the same.'
export const INVALID_LINK =
  'This link has expired or was already used. Ask for a new one.'

export type ResetPasswordFormProps = {
  /** False when the link was opened without a usable token. */
  linkIsValid: boolean
  /** Resolves to a reason when the password could not be changed, else null. */
  onReset: (newPassword: string) => Promise<string | null>
  onDone: () => void
}

export function ResetPasswordForm({
  linkIsValid,
  onReset,
  onDone,
}: ResetPasswordFormProps): React.JSX.Element {
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [changed, setChanged] = useState(false)
  const [busy, setBusy] = useState(false)
  const ids = { password: useId(), again: useId() }

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault()
      if (password !== again) return setError(MISMATCH)
      setBusy(true)
      setError(null)
      try {
        const reason = await onReset(password)
        if (reason === null) setChanged(true)
        else setError(reason)
      } finally {
        setBusy(false)
      }
    },
    [password, again, onReset],
  )

  if (changed) {
    return (
      <div className="flex w-full max-w-sm flex-col gap-4">
        <h1 className="text-heading-md">Password changed</h1>
        <p role="status" className="text-body-md">
          Your password was changed. You were signed out everywhere, so sign in
          with the new one.
        </p>
        <Button type="button" onClick={onDone}>
          Go to sign in
        </Button>
      </div>
    )
  }

  if (!linkIsValid) {
    return (
      <div className="flex w-full max-w-sm flex-col gap-4">
        <h1 className="text-heading-md">Choose a new password</h1>
        <p role="alert" className="text-body-sm text-destructive">
          {INVALID_LINK}
        </p>
        <Button type="button" onClick={onDone}>
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
      <h1 className="text-heading-md">Choose a new password</h1>
      <div className="flex flex-col gap-2">
        <Label htmlFor={ids.password}>New password</Label>
        <Input
          id={ids.password}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={ids.again}>Type it again</Label>
        <Input
          id={ids.again}
          type="password"
          value={again}
          onChange={(event) => setAgain(event.target.value)}
          autoComplete="new-password"
          required
        />
      </div>
      {error === null ? null : (
        <p role="alert" className="text-body-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy}>
        Change password
      </Button>
    </form>
  )
}
