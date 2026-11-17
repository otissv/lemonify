import { screen, within } from '@testing-library/react'
import { workflowDefinition } from '@/test/workflow-fixtures'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DocumentSummary } from '@/features/documents/document'
import { listDocuments } from '@/features/documents/document-functions'
import { listSources } from '@/features/sources/source-functions'
import { listWorkflows } from '@/features/workflows/workflow-functions'
import type { WorkflowView } from '@/server/services/workflow-service'
import { INITIAL_APP_STATE, useAppStore } from '@/store/app-store'
import { documentView } from '@/test/document-fixtures'
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
vi.mock('@/features/documents/upload-source', () => ({
  uploadSource: vi.fn(),
}))
vi.mock('@/features/sources/source-functions', () => ({
  listSources: vi.fn(),
  deleteSource: vi.fn(),
}))
vi.mock('@/features/workflows/workflow-functions', () => ({
  listWorkflows: vi.fn(),
  createWorkflowFn: vi.fn(),
}))

const MINUTE = 60_000

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * MINUTE).toISOString()
}

function documentSummary(
  index: number,
  updatedAt: string,
  fileName = `photo-${index}.png`,
): DocumentSummary {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
  const { source } = documentView([], id, fileName)
  return { id, name: `Photo ${index}`, source, revision: 0, updatedAt }
}

function workflowView(index: number, updatedAt: string): WorkflowView {
  return {
    id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    name: `Flow ${index}`,
    ...workflowDefinition(),
    revision: 0,
    createdAt: updatedAt,
    updatedAt,
  }
}

function page(): HTMLElement {
  return screen.getByRole('main')
}

describe('HomePage', () => {
  beforeEach(() => {
    useAppStore.setState(INITIAL_APP_STATE)
    vi.mocked(listDocuments).mockResolvedValue([])
    vi.mocked(listWorkflows).mockResolvedValue([])
    vi.mocked(listSources).mockResolvedValue([])
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('welcomes you with the app name, a subtitle and the sections', async () => {
    await renderApp()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Lemonify' }),
    ).toBeInTheDocument()
    expect(within(page()).getByText('Edit and process images')).toBeVisible()
    expect(
      within(page())
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual(['Start', 'Recent'])
  })

  describe('links', () => {
    it('are blue and never underlined, in Start and Recent alike', async () => {
      vi.mocked(listDocuments).mockResolvedValue([
        documentSummary(1, minutesAgo(5), 'a.png'),
      ])
      await renderApp()
      const start = await screen.findByRole('list', { name: 'Start' })
      const recent = await screen.findByRole('list', { name: 'Recent images' })
      const actions = within(start).getAllByRole('button')
      const links = within(recent).getAllByRole('link')

      expect(actions).toHaveLength(3)
      for (const element of [...actions, ...links]) {
        expect(element).toHaveClass('text-link')
        expect(element.className).not.toMatch(/underline/)
      }
    })
  })

  describe('start', () => {
    it('offers to open an image, with the file chooser behind it', async () => {
      const user = userEvent.setup()
      await renderApp()
      const input = await screen.findByLabelText('Choose an image')
      const click = vi.spyOn(input as HTMLInputElement, 'click')

      await user.click(
        within(page()).getByRole('button', { name: 'Open image…' }),
      )

      expect(click).toHaveBeenCalledTimes(1)
    })

    it('opens the library to open an image from it', async () => {
      const user = userEvent.setup()
      await renderApp()

      await user.click(
        within(page()).getByRole('button', { name: 'Open library image…' }),
      )

      expect(
        await screen.findByRole('dialog', { name: 'Open library image' }),
      ).toBeInTheDocument()
    })

    it('opens the dialog to add a workflow', async () => {
      const user = userEvent.setup()
      await renderApp()

      await user.click(
        within(page()).getByRole('button', { name: 'New workflow…' }),
      )

      expect(
        await screen.findByRole('dialog', { name: 'Add workflow' }),
      ).toBeInTheDocument()
    })

    it('has exactly one file chooser and one picker for the whole app', async () => {
      await renderApp()

      expect(await screen.findAllByLabelText('Choose an image')).toHaveLength(1)
    })
  })

  describe('recent', () => {
    it('says so when there are no images yet', async () => {
      await renderApp()

      expect(await screen.findByText('No recent images yet.')).toBeVisible()
      expect(
        within(page()).queryByRole('list', { name: 'Recent images' }),
      ).not.toBeInTheDocument()
    })

    it('lists the newest changed first, each linking to its document, with its file and age', async () => {
      const older = documentSummary(1, minutesAgo(120), 'old.png')
      const newer = documentSummary(2, minutesAgo(5), 'new.png')
      vi.mocked(listDocuments).mockResolvedValue([older, newer])
      await renderApp()

      const list = await screen.findByRole('list', { name: 'Recent images' })
      const links = within(list).getAllByRole('link')

      expect(links.map((link) => link.getAttribute('href'))).toEqual([
        `/documents/${newer.id}`,
        `/documents/${older.id}`,
      ])
      expect(links[0]).toHaveTextContent('Photo 2')
      expect(links[0]).toHaveTextContent('new.png')
      expect(links[0]).toHaveTextContent('5 minutes ago')
      expect(links[1]).toHaveTextContent('2 hours ago')
    })

    it('shows at most eight', async () => {
      vi.mocked(listDocuments).mockResolvedValue(
        Array.from({ length: 11 }, (_, index) =>
          documentSummary(index + 1, minutesAgo(index + 1)),
        ),
      )
      await renderApp()

      const list = await screen.findByRole('list', { name: 'Recent images' })

      expect(within(list).getAllByRole('link')).toHaveLength(8)
      expect(within(list).getByRole('link', { name: /Photo 8/ })).toBeVisible()
      expect(
        within(list).queryByRole('link', { name: /Photo 9/ }),
      ).not.toBeInTheDocument()
    })
  })

  describe('workflows', () => {
    it('is not shown when there are none', async () => {
      await renderApp()
      await screen.findByText('No recent images yet.')

      expect(
        within(page()).queryByRole('heading', { name: 'Workflows' }),
      ).not.toBeInTheDocument()
    })

    it('lists up to five, newest changed first, each linking to its workflow', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(
        Array.from({ length: 7 }, (_, index) =>
          workflowView(index + 1, minutesAgo((7 - index) * 10)),
        ),
      )
      await renderApp()

      const list = await screen.findByRole('list', { name: 'Recent workflows' })
      const links = within(list).getAllByRole('link')

      expect(links.map((link) => link.textContent)).toEqual([
        expect.stringContaining('Flow 7'),
        expect.stringContaining('Flow 6'),
        expect.stringContaining('Flow 5'),
        expect.stringContaining('Flow 4'),
        expect.stringContaining('Flow 3'),
      ])
      expect(links[0]).toHaveAttribute(
        'href',
        '/workflows/10000000-0000-4000-8000-000000000007',
      )
    })
  })
})
