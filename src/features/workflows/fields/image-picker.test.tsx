import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SourceSummary } from '@/features/documents/document'
import { listSources } from '@/features/sources/source-functions'
import { ImageChoicesContext } from '@/features/workflows/fields/image-choices'
import { ImagePicker } from '@/features/workflows/fields/image-picker'
import {
  INITIAL_SOURCES_STATE,
  useSourcesStore,
} from '@/features/workflows/sources-store'

vi.mock('@/features/sources/source-functions', () => ({
  listSources: vi.fn(),
  deleteSource: vi.fn(),
}))

function source(index: number): SourceSummary {
  return {
    id: `s${index}`,
    fileName: `image-${index}.png`,
    mediaType: 'image/png',
    bytes: 10,
    width: 4,
    height: 3,
  }
}

const SEVEN = [1, 2, 3, 4, 5, 6, 7].map(source)

beforeEach(() => {
  useSourcesStore.setState(INITIAL_SOURCES_STATE)
  vi.mocked(listSources).mockResolvedValue(SEVEN)
})

afterEach(() => {
  vi.resetAllMocks()
})

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole('button', { name: 'Choose an image for image' }),
  )
  return screen.findByRole('menu')
}

describe('ImagePicker with the whole library to choose from', () => {
  it('lists the five most recently uploaded images, then the library', async () => {
    const user = userEvent.setup()
    render(<ImagePicker label="image" onPick={() => {}} />)

    const menu = await openMenu(user)

    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual([
      'image-1.png',
      'image-2.png',
      'image-3.png',
      'image-4.png',
      'image-5.png',
      'Choose from library…',
    ])
  })

  it('picks a recent image', async () => {
    const onPick = vi.fn()
    const user = userEvent.setup()
    render(<ImagePicker label="image" onPick={onPick} />)

    await user.click(
      within(await openMenu(user)).getByRole('menuitem', {
        name: 'image-2.png',
      }),
    )

    expect(onPick).toHaveBeenCalledWith('s2')
  })

  it('opens the library for any image, and picks from it', async () => {
    const onPick = vi.fn()
    const user = userEvent.setup()
    render(<ImagePicker label="image" onPick={onPick} />)

    await user.click(
      within(await openMenu(user)).getByRole('menuitem', {
        name: 'Choose from library…',
      }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Library' })
    await user.click(
      await within(dialog).findByRole('button', { name: 'Choose image-7.png' }),
    )

    expect(onPick).toHaveBeenCalledWith('s7')
  })

  it('names the upload button as asked', async () => {
    render(
      <ImagePicker
        label="image"
        uploadLabel="Replace image…"
        onPick={() => {}}
      />,
    )

    expect(
      await screen.findByRole('button', { name: 'Replace image…' }),
    ).toBeVisible()
  })

  it('offers only the library when there are no recent images', async () => {
    vi.mocked(listSources).mockResolvedValue([])
    const user = userEvent.setup()
    render(<ImagePicker label="image" onPick={() => {}} />)

    const menu = await openMenu(user)

    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Choose from library…'])
  })
})

describe('ImagePicker where the editor limits the choice', () => {
  it('offers only the images opened so far, and no library', async () => {
    const user = userEvent.setup()
    render(
      <ImageChoicesContext.Provider value={[source(2), source(3)]}>
        <ImagePicker label="operand" onPick={() => {}} />
      </ImageChoicesContext.Provider>,
    )

    await user.click(
      await screen.findByRole('button', {
        name: 'Use an opened image for operand',
      }),
    )

    expect(
      within(await screen.findByRole('menu'))
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['image-2.png', 'image-3.png'])
  })
})
