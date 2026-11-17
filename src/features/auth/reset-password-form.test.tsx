import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import {
  INVALID_LINK,
  MISMATCH,
  ResetPasswordForm,
} from '@/features/auth/reset-password-form'

function setup(onReset = vi.fn().mockResolvedValue(null), linkIsValid = true) {
  const onDone = vi.fn()
  render(
    <ResetPasswordForm
      linkIsValid={linkIsValid}
      onReset={onReset}
      onDone={onDone}
    />,
  )
  return { onReset, onDone, user: userEvent.setup() }
}

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  first: string,
  second: string,
): Promise<void> {
  await user.type(screen.getByLabelText('New password'), first)
  await user.type(screen.getByLabelText('Type it again'), second)
  await user.click(screen.getByRole('button', { name: 'Change password' }))
}

describe('ResetPasswordForm', () => {
  it('changes the password and says what happens next', async () => {
    const { onReset, onDone, user } = setup()

    await fill(user, 'a brand new password', 'a brand new password')

    await waitFor(() =>
      expect(onReset).toHaveBeenCalledWith('a brand new password'),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'You were signed out everywhere',
    )
    await user.click(screen.getByRole('button', { name: 'Go to sign in' }))
    expect(onDone).toHaveBeenCalled()
  })

  it('does not send two passwords that differ', async () => {
    const { onReset, user } = setup()

    await fill(user, 'a brand new password', 'a brand new passwore')

    expect(await screen.findByRole('alert')).toHaveTextContent(MISMATCH)
    expect(onReset).not.toHaveBeenCalled()
  })

  it('shows why the password could not be changed', async () => {
    const { user } = setup(vi.fn().mockResolvedValue('Invalid token'))

    await fill(user, 'a brand new password', 'a brand new password')

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid token')
  })

  it('says so, instead of showing a form, when the link has no token', async () => {
    const { onDone, user } = setup(undefined, false)

    expect(screen.getByRole('alert')).toHaveTextContent(INVALID_LINK)
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to sign in' }))
    expect(onDone).toHaveBeenCalled()
  })
})
