import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SourceSummary } from '@/features/documents/document'
import { ImageLibrary } from '@/features/library/image-library'
import { deleteSource, listSources } from '@/features/sources/source-functions'
import {
  INITIAL_SOURCES_STATE,
  useSourcesStore,
} from '@/features/workflows/sources-store'

vi.mock('@/features/sources/source-functions', () => ({
  listSources: vi.fn(),
  deleteSource: vi.fn(),
}))

function source(id: string, fileName = `${id}.png`): SourceSummary {
  return {
    id,
    fileName,
    mediaType: 'image/png',
    bytes: 10,
    width: 4,
    height: 3,
  }
}

beforeEach(() => {
  useSourcesStore.setState(INITIAL_SOURCES_STATE)
})

afterEach(() => {
  vi.resetAllMocks()
})

describe('ImageLibrary', () => {
  it('shows every image of the library, newest first, with its name', async () => {
    vi.mocked(listSources).mockResolvedValue([source('b'), source('a')])

    render(<ImageLibrary onChoose={() => {}} />)

    const list = await screen.findByRole('list', { name: 'Library' })
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringContaining('b.png'),
      expect.stringContaining('a.png'),
    ])
    expect(list.querySelector('img')).toHaveAttribute('src', '/api/sources/b')
  })

  it('hands back the image that was chosen', async () => {
    vi.mocked(listSources).mockResolvedValue([source('a')])
    const onChoose = vi.fn()
    const user = userEvent.setup()
    render(<ImageLibrary onChoose={onChoose} />)

    await user.click(
      await screen.findByRole('button', { name: 'Choose a.png' }),
    )

    expect(onChoose).toHaveBeenCalledWith(source('a'))
  })

  it('says when the library is empty', async () => {
    vi.mocked(listSources).mockResolvedValue([])

    render(<ImageLibrary onChoose={() => {}} />)

    expect(await screen.findByText('Your library is empty.')).toBeVisible()
  })

  it('says why the library could not be listed', async () => {
    vi.mocked(listSources).mockRejectedValue(new Error('Offline.'))

    render(<ImageLibrary onChoose={() => {}} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Offline.')
  })

  it('reads the library again each time it is shown', async () => {
    vi.mocked(listSources).mockResolvedValue([source('a')])
    const { unmount } = render(<ImageLibrary onChoose={() => {}} />)
    await screen.findByText('a.png')
    unmount()
    vi.mocked(listSources).mockResolvedValue([source('c'), source('a')])

    render(<ImageLibrary onChoose={() => {}} />)

    expect(await screen.findByText('c.png')).toBeVisible()
  })

  it('removes an image from the library', async () => {
    vi.mocked(listSources).mockResolvedValue([source('a'), source('b')])
    vi.mocked(deleteSource).mockResolvedValue()
    const user = userEvent.setup()
    render(<ImageLibrary onChoose={() => {}} />)

    await user.click(
      await screen.findByRole('button', { name: 'Delete a.png' }),
    )

    expect(deleteSource).toHaveBeenCalledWith({ data: { id: 'a' } })
    await waitFor(() => {
      expect(screen.queryByText('a.png')).not.toBeInTheDocument()
    })
    expect(screen.getByText('b.png')).toBeVisible()
  })

  it('says why an image could not be deleted, and keeps it', async () => {
    vi.mocked(listSources).mockResolvedValue([source('a')])
    vi.mocked(deleteSource).mockRejectedValue(
      new Error('This image is used by an open image or one of its steps.'),
    )
    const user = userEvent.setup()
    render(<ImageLibrary onChoose={() => {}} />)

    await user.click(
      await screen.findByRole('button', { name: 'Delete a.png' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This image is used by an open image',
    )
    expect(screen.getByText('a.png')).toBeVisible()
  })
})
