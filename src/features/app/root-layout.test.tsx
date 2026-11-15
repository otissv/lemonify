import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { listDocuments } from '@/features/documents/document-functions'
import { listWorkflows } from '@/features/workflows/workflow-functions'
import { renderApp } from '@/test/render-app'

vi.mock('@/features/documents/document-functions', () => ({
  listDocuments: vi.fn(),
  getDocument: vi.fn(),
  createDocument: vi.fn(),
  deleteDocument: vi.fn(),
  changeDocument: vi.fn(),
  undoDocument: vi.fn(),
  redoDocument: vi.fn(),
}))
vi.mock('@/features/workflows/workflow-functions', () => ({
  listWorkflows: vi.fn(),
}))
vi.mock('@/features/auth/auth-client', () => ({ signOut: vi.fn() }))

describe('RootLayout', () => {
  it('shows the app shell and the User name when signed in', async () => {
    vi.mocked(listDocuments).mockResolvedValue([])
    vi.mocked(listWorkflows).mockResolvedValue([])
    await renderApp('/')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Lemonify' }),
    ).toBeVisible()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('menuitem', { name: 'Account' }))
    const account = await screen.findByRole('menu', { name: 'Account' })
    expect(within(account).getByText('Ann')).toBeVisible()
    expect(
      within(account).getByRole('menuitem', { name: 'Sign out' }),
    ).toBeVisible()
  })

  it('shows only the sign-in page, loading no app data, when signed out', async () => {
    vi.mocked(listDocuments).mockClear()
    vi.mocked(listWorkflows).mockClear()
    const { router } = await renderApp('/documents/abc', null)
    expect(
      await screen.findByRole('heading', { name: 'Sign in page' }),
    ).toBeVisible()
    expect(router.state.location.pathname).toBe('/sign-in')
    expect(
      screen.queryByRole('menuitem', { name: 'Account' }),
    ).not.toBeInTheDocument()
    expect(listDocuments).not.toHaveBeenCalled()
    expect(listWorkflows).not.toHaveBeenCalled()
  })
})
