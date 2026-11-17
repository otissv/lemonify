import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { SignInForm } from '@/features/auth/sign-in-form'
import type { SignInFormProps } from '@/features/auth/sign-in-form'

function setup(overrides: Partial<SignInFormProps> = {}) {
  const props: SignInFormProps = {
    emailEnabled: false,
    onSignIn: vi.fn().mockResolvedValue({ error: null }),
    onSignUp: vi.fn().mockResolvedValue({ error: null }),
    onForgotPassword: vi.fn().mockResolvedValue(null),
    onResendVerification: vi.fn().mockResolvedValue(null),
    ...overrides,
  }
  render(<SignInForm {...props} />)
  return { props, user: userEvent.setup() }
}

async function fillSignIn(
  user: ReturnType<typeof userEvent.setup>,
  password = 'correct horse',
): Promise<void> {
  await user.type(screen.getByLabelText('Email'), 'ann@example.com')
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('SignInForm', () => {
  it('signs in with the email and password', async () => {
    const { props, user } = setup()
    await fillSignIn(user)
    await waitFor(() =>
      expect(props.onSignIn).toHaveBeenCalledWith(
        'ann@example.com',
        'correct horse',
      ),
    )
  })

  it('shows the reason in an alert when sign-in fails', async () => {
    const { user } = setup({
      onSignIn: vi
        .fn()
        .mockResolvedValue({ error: 'Invalid email or password' }),
    })
    await fillSignIn(user, 'nope')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invalid email or password',
    )
  })

  it('switches to creating an account, which also asks for a name', async () => {
    const { props, user } = setup()
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
      expect(props.onSignUp).toHaveBeenCalledWith(
        'Ann',
        'ann@example.com',
        'long enough password',
      ),
    )
  })

  it('clears the error when switching modes', async () => {
    const { user } = setup({
      onSignIn: vi.fn().mockResolvedValue({ error: 'Bad' }),
    })
    await fillSignIn(user, 'x')
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'Create an account' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('disables the submit button while the request runs', async () => {
    let finish: (value: { error: null }) => void = () => undefined
    const pending = new Promise<{ error: null }>((resolve) => {
      finish = resolve
    })
    const { user } = setup({ onSignIn: vi.fn().mockReturnValue(pending) })
    await fillSignIn(user, 'x')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()
    finish({ error: null })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled(),
    )
  })

  describe('when email is not set up', () => {
    it('offers no password reset', () => {
      setup({ emailEnabled: false })
      expect(
        screen.queryByRole('button', { name: 'Forgot your password?' }),
      ).not.toBeInTheDocument()
    })
  })

  describe('confirming an email after sign-up', () => {
    async function signUp(user: ReturnType<typeof userEvent.setup>) {
      await user.click(
        screen.getByRole('button', { name: 'Create an account' }),
      )
      await user.type(screen.getByLabelText('Name'), 'Ann')
      await user.type(screen.getByLabelText('Email'), 'ann@example.com')
      await user.type(screen.getByLabelText('Password'), 'long enough password')
      await user.click(screen.getByRole('button', { name: 'Create account' }))
    }

    it('tells the person to check their email instead of signing them in', async () => {
      const { user } = setup({
        emailEnabled: true,
        onSignUp: vi
          .fn()
          .mockResolvedValue({ error: null, confirmEmail: true }),
      })

      await signUp(user)

      expect(await screen.findByRole('status')).toHaveTextContent(
        'Check your email. We sent a link to ann@example.com to confirm your account.',
      )
      await user.click(screen.getByRole('button', { name: 'Back to sign in' }))
      expect(screen.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    })
  })

  describe('an email that has not been confirmed', () => {
    it('offers to send the link again, and says it was sent', async () => {
      const { props, user } = setup({
        emailEnabled: true,
        onSignIn: vi.fn().mockResolvedValue({
          error: 'Email not verified',
          unverified: true,
        }),
      })
      await fillSignIn(user)

      await user.click(
        await screen.findByRole('button', { name: 'Send the link again' }),
      )

      expect(props.onResendVerification).toHaveBeenCalledWith('ann@example.com')
      expect(await screen.findByRole('status')).toHaveTextContent(
        'We sent a new link to ann@example.com.',
      )
    })

    it('shows why when it could not be sent', async () => {
      const { user } = setup({
        emailEnabled: true,
        onSignIn: vi
          .fn()
          .mockResolvedValue({ error: 'Email not verified', unverified: true }),
        onResendVerification: vi.fn().mockResolvedValue('Try again later.'),
      })
      await fillSignIn(user)

      await user.click(
        await screen.findByRole('button', { name: 'Send the link again' }),
      )

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Try again later.',
      )
    })
  })

  describe('forgetting the password', () => {
    it('asks for the email and says a link was sent, whether or not there is an account', async () => {
      const { props, user } = setup({ emailEnabled: true })

      await user.click(
        screen.getByRole('button', { name: 'Forgot your password?' }),
      )
      expect(
        screen.getByRole('heading', { name: 'Reset your password' }),
      ).toBeVisible()
      expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
      await user.type(screen.getByLabelText('Email'), 'ann@example.com')
      await user.click(screen.getByRole('button', { name: 'Send reset link' }))

      await waitFor(() =>
        expect(props.onForgotPassword).toHaveBeenCalledWith('ann@example.com'),
      )
      expect(await screen.findByRole('status')).toHaveTextContent(
        'If there is an account for ann@example.com, we sent a link to reset the password.',
      )
    })

    it('shows why when the request fails', async () => {
      const { user } = setup({
        emailEnabled: true,
        onForgotPassword: vi.fn().mockResolvedValue('Too many requests.'),
      })
      await user.click(
        screen.getByRole('button', { name: 'Forgot your password?' }),
      )
      await user.type(screen.getByLabelText('Email'), 'ann@example.com')
      await user.click(screen.getByRole('button', { name: 'Send reset link' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Too many requests.',
      )
    })

    it('goes back to signing in', async () => {
      const { user } = setup({ emailEnabled: true })
      await user.click(
        screen.getByRole('button', { name: 'Forgot your password?' }),
      )

      await user.click(screen.getByRole('button', { name: 'Back to sign in' }))

      expect(screen.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    })
  })
})
