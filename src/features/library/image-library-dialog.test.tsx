import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SourceSummary } from '@/features/documents/document'
import { ImageLibraryDialog } from '@/features/library/image-library-dialog'
import { listSources } from '@/features/sources/source-functions'
import {
  INITIAL_SOURCES_STATE,
  useSourcesStore,
} from '@/features/workflows/sources-store'

vi.mock('@/features/sources/source-functions', () => ({
  listSources: vi.fn(),
  deleteSource: vi.fn(),
}))

const A: SourceSummary = {
  id: 'a',
  fileName: 'a.png',
  mediaType: 'image/png',
  bytes: 10,
  width: 4,
  height: 3,
}

beforeEach(() => {
  useSourcesStore.setState(INITIAL_SOURCES_STATE)
  vi.mocked(listSources).mockResolvedValue([A])
})

afterEach(() => {
  vi.resetAllMocks()
})

function show(
  props: Partial<React.ComponentProps<typeof ImageLibraryDialog>> = {},
) {
  const onChoose = vi.fn().mockResolvedValue(undefined)
  const onOpenChange = vi.fn()
  render(
    <ImageLibraryDialog
      open
      onOpenChange={onOpenChange}
      title="Insert image"
      description="Add an image from your library."
      onChoose={onChoose}
      {...props}
    />,
  )
  return { onChoose, onOpenChange }
}

describe('ImageLibraryDialog', () => {
  it('is named for what it does, and lists the library', async () => {
    show()

    expect(
      await screen.findByRole('dialog', { name: 'Insert image' }),
    ).toBeVisible()
    expect(screen.getByText('Add an image from your library.')).toBeVisible()
    expect(await screen.findByText('a.png')).toBeVisible()
  })

  it('hands back the image chosen, then closes', async () => {
    const { onChoose, onOpenChange } = show()
    const user = userEvent.setup()

    await user.click(
      await screen.findByRole('button', { name: 'Choose a.png' }),
    )

    expect(onChoose).toHaveBeenCalledWith([A])
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('stays open and says why when the choice could not be used', async () => {
    const { onOpenChange } = show({
      onChoose: vi.fn().mockRejectedValue(new Error('Could not open it.')),
    })
    const user = userEvent.setup()

    await user.click(
      await screen.findByRole('button', { name: 'Choose a.png' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not open it.',
    )
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('offers an upload when it is given something to do with uploaded images, and hands them back', async () => {
    const uploaded: SourceSummary = { ...A, id: 'u', fileName: 'u.png' }
    useSourcesStore.setState({ upload: vi.fn().mockResolvedValue(uploaded) })
    const { onChoose, onOpenChange } = show({
      uploadLabel: 'Upload from computer…',
    })
    const user = userEvent.setup()

    await user.upload(
      await screen.findByLabelText('Upload from computer… file'),
      new File(['x'], 'u.png', { type: 'image/png' }),
    )

    await waitFor(() => {
      expect(onChoose).toHaveBeenCalledWith([uploaded])
    })
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('has no upload unless asked to', async () => {
    show()
    await screen.findByText('a.png')

    expect(
      screen.queryByRole('button', { name: /Upload/ }),
    ).not.toBeInTheDocument()
  })
})
