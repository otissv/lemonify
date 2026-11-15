import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { SignInForm } from '@/features/auth/sign-in-form'

function setup(
  onSignIn = vi.fn().mockResolvedValue(null),
  onSignUp = vi.fn().mockResolvedValue(null),
) {
  render(<SignInForm onSignIn={onSignIn} onSignUp={onSignUp} />)
  return { onSignIn, onSignUp, user: userEvent.setup() }
}

describe('SignInForm', () => {
  it('signs in with the email and password', async () => {
    const { onSignIn, user } = setup()
    await user.type(screen.getByLabelText('Email'), 'ann@example.com')
    await user.type(screen.getByLabelText('Password'), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() =>
      expect(onSignIn).toHaveBeenCalledWith('ann@example.com', 'correct horse'),
    )
  })

  it('shows the reason in an alert when sign-in fails', async () => {
    const { user } = setup(
      vi.fn().mockResolvedValue('Invalid email or password'),
    )
    await user.type(screen.getByLabelText('Email'), 'ann@example.com')
    await user.type(screen.getByLabelText('Password'), 'nope')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invalid email or password',
    )
  })

  it('switches to creating an account, which also asks for a name', async () => {
    const { onSignUp, user } = setup()
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create an account' }))
    expect(
      screen.getByRole('heading', { name: 'Create an account' }),
    ).toBeVisible()
    await user.type(screen.getByLabelText('Name'), 'Ann')
    await user.type(screen.getByLabelText('Email'), 'ann@example.com')
    await user.type(screen.getByLabelText('Password'), 'long enough password')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() =>
      expect(onSignUp).toHaveBeenCalledWith(
        'Ann',
        'ann@example.com',
        'long enough password',
      ),
    )
  })

  it('clears the error when switching modes', async () => {
    const { user } = setup(vi.fn().mockResolvedValue('Bad'))
    await user.type(screen.getByLabelText('Email'), 'a@b.co')
    await user.type(screen.getByLabelText('Password'), 'x')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'Create an account' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('disables the submit button while the request runs', async () => {
    let finish: (value: string | null) => void = () => undefined
    const pending = new Promise<string | null>((resolve) => {
      finish = resolve
    })
    const { user } = setup(vi.fn().mockReturnValue(pending))
    await user.type(screen.getByLabelText('Email'), 'a@b.co')
    await user.type(screen.getByLabelText('Password'), 'x')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()
    finish(null)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled(),
    )
  })
})
