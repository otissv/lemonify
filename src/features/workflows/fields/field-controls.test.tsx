import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { listSources } from '@/features/sources/source-functions'
import { SharpOptionsForm } from '@/features/workflows/sharp-options-form'
import { INITIAL_LIBRARY_STATE, useLibraryStore } from '@/store/library-store'

vi.mock('@/features/sources/source-functions', () => ({
  listSources: vi.fn(),
}))

const MASK = {
  id: 'src-mask',
  fileName: 'mask.png',
  mediaType: 'image/png',
  bytes: 10,
  width: 4,
  height: 4,
}
const ONE = { ...MASK, id: 'src-one', fileName: 'one.png' }
const TWO = { ...MASK, id: 'src-two', fileName: 'two.png' }

/** Makes the next upload answer with this Source, as the server does. */
function uploadsAs(source: typeof MASK): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ data: [source], error: '' }, { status: 201 }),
    ),
  )
}

function chooseFile(label: string): File {
  const file = new File(['x'], 'picked.png', { type: 'image/png' })
  const input = screen.getByLabelText(label)
  fireEvent.change(input, { target: { files: [file] } })
  return file
}

type Options = Parameters<typeof SharpOptionsForm>[0]['options']

let latest: Options = {}

function Harness({
  op,
  initial,
}: {
  op: string
  initial: Options
}): React.JSX.Element {
  const [options, setOptions] = useState(initial)
  latest = options
  return (
    <SharpOptionsForm
      op={op}
      options={options}
      onChange={(next) => {
        latest = next
        setOptions(next)
      }}
    />
  )
}

function show(op: string, initial: Options = {}): void {
  latest = initial
  render(<Harness op={op} initial={initial} />)
}

describe('option controls', () => {
  beforeEach(() => {
    useLibraryStore.setState(INITIAL_LIBRARY_STATE)
    vi.mocked(listSources).mockResolvedValue([])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetAllMocks()
  })

  describe('bounded numbers', () => {
    it('sets quality with a slider', async () => {
      const user = userEvent.setup()
      show('jpeg')
      const quality = screen.getByRole('slider', { name: 'Quality' })
      expect(quality).toBeVisible()
      expect(quality).toHaveAttribute('aria-valuenow', '1')

      quality.focus()
      await user.keyboard('{End}')

      expect(latest).toEqual({ quality: 100 })
    })

    it('shows opacity percent on a slider', async () => {
      const user = userEvent.setup()
      show('opacity', { percent: 40 })

      expect(screen.getByRole('slider', { name: 'Percent' })).toBeVisible()
      expect(screen.getByText('40')).toBeVisible()

      screen.getByRole('slider', { name: 'Percent' }).focus()
      await user.keyboard('{ArrowRight}')
      await user.keyboard('{ArrowRight}')
      await user.keyboard('{ArrowRight}')

      expect(latest.percent).toBeGreaterThan(40)
    })
  })

  describe('colour', () => {
    it('takes a colour typed as text', async () => {
      const user = userEvent.setup()
      show('flatten')

      await user.type(screen.getByLabelText('Background'), 'red')

      expect(latest).toEqual({ background: 'red' })
    })

    it('opens a picker from the swatch, showing the new colour beside the current one', async () => {
      const user = userEvent.setup()
      show('flatten', { background: '#00ff00' })

      await user.click(
        screen.getByRole('button', { name: 'Background picker' }),
      )

      expect(
        await screen.findByRole('img', { name: 'New colour' }),
      ).toBeVisible()
      expect(screen.getByRole('img', { name: 'Current colour' })).toBeVisible()
      expect(screen.getByLabelText('Hex')).toHaveValue('00ff00')
    })

    it('takes a colour from the hex field', async () => {
      const user = userEvent.setup()
      show('flatten')
      await user.click(
        screen.getByRole('button', { name: 'Background picker' }),
      )

      await user.clear(await screen.findByLabelText('Hex'))
      await user.type(screen.getByLabelText('Hex'), 'ff8000')

      expect(latest).toEqual({ background: '#ff8000' })
    })

    it('takes a three-digit shorthand when the hex field is left', async () => {
      const user = userEvent.setup()
      show('flatten')
      await user.click(
        screen.getByRole('button', { name: 'Background picker' }),
      )

      await user.clear(await screen.findByLabelText('Hex'))
      await user.type(screen.getByLabelText('Hex'), 'f80')
      expect(latest).toEqual({})
      await user.tab()

      expect(latest).toEqual({ background: '#ff8800' })
    })

    it('takes a colour from the red, green and blue fields', async () => {
      const user = userEvent.setup()
      show('flatten', { background: '#000000' })
      await user.click(
        screen.getByRole('button', { name: 'Background picker' }),
      )

      await user.clear(await screen.findByLabelText('Green'))
      await user.type(screen.getByLabelText('Green'), '128')

      expect(latest).toEqual({ background: '#008000' })
    })

    it('takes a colour from the hue slider, keeping saturation and brightness', async () => {
      show('flatten', { background: '#ff0000' })
      await userEvent
        .setup()
        .click(screen.getByRole('button', { name: 'Background picker' }))

      fireEvent.change(await screen.findByRole('slider', { name: 'Hue' }), {
        target: { value: '120' },
      })

      expect(latest).toEqual({ background: '#00ff00' })
    })

    it('moves with the arrow keys in the saturation and brightness area', async () => {
      const user = userEvent.setup()
      show('flatten', { background: '#ff0000' })
      await user.click(
        screen.getByRole('button', { name: 'Background picker' }),
      )

      const area = await screen.findByRole('slider', {
        name: 'Saturation and brightness',
      })
      area.focus()
      await user.keyboard('{Shift>}{ArrowDown}{/Shift}')

      expect(area).toHaveAttribute(
        'aria-valuetext',
        'Saturation 100%, brightness 90%',
      )
      expect(latest).toEqual({ background: '#e60000' })
    })

    it('becomes {r, g, b, alpha} once it is see-through', async () => {
      show('flatten', { background: '#00ff00' })
      await userEvent
        .setup()
        .click(screen.getByRole('button', { name: 'Background picker' }))

      fireEvent.change(await screen.findByRole('slider', { name: 'Opacity' }), {
        target: { value: '50' },
      })

      expect(latest).toEqual({
        background: { r: 0, g: 255, b: 0, alpha: 0.5 },
      })
    })

    it('shows a colour set as an object in the hex field with its opacity', async () => {
      show('flatten', { background: { r: 255, g: 0, b: 0, alpha: 0.25 } })
      await userEvent
        .setup()
        .click(screen.getByRole('button', { name: 'Background picker' }))

      expect(await screen.findByLabelText('Hex')).toHaveValue('ff000040')
      expect(screen.getByRole('slider', { name: 'Opacity' })).toHaveValue('25')
    })

    it('clears the colour', async () => {
      const user = userEvent.setup()
      show('flatten', { background: '#00ff00' })

      await user.click(screen.getByRole('button', { name: 'Clear Background' }))

      expect(latest).toEqual({})
    })

    it('needs a colour for tint, which cannot be cleared', () => {
      show('tint')

      expect(screen.getByText('Required.')).toBeVisible()
      expect(
        screen.queryByRole('button', { name: /^Clear/ }),
      ).not.toBeInTheDocument()
    })
  })

  describe('matrix', () => {
    it('shows the identity for a new affine matrix, and writes nested rows on a change', async () => {
      const user = userEvent.setup()
      show('affine')
      expect(screen.getByLabelText('Row 1, column 1')).toHaveValue(1)
      expect(screen.getByLabelText('Row 1, column 2')).toHaveValue(0)

      await user.clear(screen.getByLabelText('Row 1, column 1'))
      await user.type(screen.getByLabelText('Row 1, column 1'), '2')

      expect(latest).toEqual({
        matrix: [
          [2, 0],
          [0, 1],
        ],
      })
    })

    it('does not write a matrix while a cell is empty', async () => {
      const user = userEvent.setup()
      show('affine')

      await user.clear(screen.getByLabelText('Row 1, column 1'))

      expect(latest).toEqual({})
    })

    it('reads a flat affine matrix', () => {
      show('affine', { matrix: [1, 2, 3, 4] })

      expect(screen.getByLabelText('Row 2, column 1')).toHaveValue(3)
    })

    it('offers 3 × 3 and 4 × 4 for recomb, starting from the identity of the new size', async () => {
      const user = userEvent.setup()
      show('recomb', {
        matrix: [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
      })

      await user.click(screen.getByRole('combobox', { name: 'Matrix size' }))
      await user.click(screen.getByRole('option', { name: '4 × 4' }))

      expect(latest.matrix).toEqual([
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
      ])
      expect(screen.getByLabelText('Row 4, column 4')).toHaveValue(1)
    })

    it('asks for width and height before showing a convolve kernel', () => {
      show('convolve')

      expect(
        screen.getByText('Set width and height to edit the kernel.'),
      ).toBeVisible()
    })

    it('shows the kernel as wide and high as the step says, and writes it flat', async () => {
      const user = userEvent.setup()
      show('convolve', { width: 2, height: 2 })

      await user.clear(screen.getByLabelText('Row 2, column 2'))
      await user.type(screen.getByLabelText('Row 2, column 2'), '5')

      expect(latest.kernel).toEqual([0, 0, 0, 5])
    })

    it('keeps the kernel the size of its width and height when they change', () => {
      show('convolve', { width: 2, height: 2, kernel: [1, 2, 3, 4] })

      fireEvent.change(screen.getByLabelText('Width'), {
        target: { value: '3' },
      })

      expect(latest.kernel).toEqual([1, 2, 0, 3, 4, 0])
      expect(screen.getByLabelText('Row 2, column 3')).toHaveValue(0)
    })

    it('pads or cuts the kernel to the new size when a size was cleared first', async () => {
      const user = userEvent.setup()
      show('convolve', { width: 2, height: 2, kernel: [1, 2, 3, 4] })

      await user.clear(screen.getByLabelText('Width'))
      await user.type(screen.getByLabelText('Width'), '3')

      expect(latest.kernel).toEqual([1, 2, 3, 4, 0, 0])
    })

    it('shows what undo restores in the grid', () => {
      const { rerender } = render(
        <SharpOptionsForm
          op="affine"
          options={{
            matrix: [
              [1, 2],
              [3, 4],
            ],
          }}
          onChange={vi.fn()}
        />,
      )

      rerender(
        <SharpOptionsForm
          op="affine"
          options={{
            matrix: [
              [9, 2],
              [3, 4],
            ],
          }}
          onChange={vi.fn()}
        />,
      )

      expect(screen.getByLabelText('Row 1, column 1')).toHaveValue(9)
    })
  })

  describe('other images', () => {
    it('uploads an image and uses its id', async () => {
      uploadsAs(MASK)
      show('boolean', { operator: 'and' })
      expect(screen.getByText('No image chosen.')).toBeVisible()

      chooseFile('Upload operand… file')

      await waitFor(() =>
        expect(latest).toEqual({ operator: 'and', operand: 'src-mask' }),
      )
      expect(await screen.findByText('mask.png')).toBeVisible()
    })

    it('says why an upload failed and keeps what was chosen', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          Response.json(
            { data: [], error: 'notes.txt is not an image' },
            { status: 422 },
          ),
        ),
      )
      show('boolean', { operand: 'src-mask' })

      chooseFile('Upload operand… file')

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'notes.txt is not an image',
      )
      expect(latest).toEqual({ operand: 'src-mask' })
    })

    it('uses one of your images', async () => {
      vi.mocked(listSources).mockResolvedValue([ONE])
      const user = userEvent.setup()
      show('boolean')

      await user.click(
        await screen.findByRole('button', {
          name: 'Choose an image for operand',
        }),
      )
      await user.click(await screen.findByRole('menuitem', { name: 'one.png' }))

      expect(latest).toEqual({ operand: 'src-one' })
    })

    it('removes the image', async () => {
      vi.mocked(listSources).mockResolvedValue([MASK])
      const user = userEvent.setup()
      show('boolean', { operand: 'src-mask' })

      await user.click(
        await screen.findByRole('button', { name: 'Remove mask.png' }),
      )

      expect(latest).toEqual({})
    })

    it('collects several images for join channel', async () => {
      vi.mocked(listSources).mockResolvedValue([ONE, TWO])
      const user = userEvent.setup()
      show('joinChannel', { images: ['src-one', 'src-two'] })

      expect(await screen.findByText('one.png')).toBeVisible()
      await user.click(screen.getByRole('button', { name: 'Remove one.png' }))

      expect(latest).toEqual({ images: ['src-two'] })
    })
  })
})
