import { fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ResizeHandle } from '@/components/ui/resize-handle'

const BOUNDS = { left: 100, right: 1100, width: 1000 }

function Harness({
  panelSide,
  initial = 0.5,
}: {
  panelSide: 'start' | 'end'
  initial?: number
}): React.JSX.Element {
  const boundsRef = useRef<HTMLDivElement>(null)
  const [share, setShare] = useState(initial)
  return (
    <div ref={boundsRef} data-testid="bounds">
      <ResizeHandle
        label="Resize preview"
        value={share}
        defaultValue={0.5}
        min={0.2}
        max={0.8}
        panelSide={panelSide}
        boundsRef={boundsRef}
        onChange={setShare}
      />
      <output data-testid="share">{share.toFixed(2)}</output>
    </div>
  )
}

function stubBounds(): void {
  vi.spyOn(
    screen.getByTestId('bounds'),
    'getBoundingClientRect',
  ).mockReturnValue({
    ...BOUNDS,
    top: 0,
    bottom: 500,
    height: 500,
    x: BOUNDS.left,
    y: 0,
    toJSON: () => ({}),
  })
}

function shareShown(): string {
  return screen.getByTestId('share').textContent ?? ''
}

describe('ResizeHandle', () => {
  it('is a focusable vertical separator that reports the panel share as a percentage', () => {
    render(<Harness panelSide="end" />)
    const handle = screen.getByRole('separator', { name: 'Resize preview' })
    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
    expect(handle).toHaveAttribute('aria-valuenow', '50')
    expect(handle).toHaveAttribute('aria-valuemin', '20')
    expect(handle).toHaveAttribute('aria-valuemax', '80')
    expect(handle).toHaveAttribute('tabindex', '0')
  })

  it('grows a panel on the end side when dragged towards the start, within its limits', () => {
    render(<Harness panelSide="end" />)
    stubBounds()
    const handle = screen.getByRole('separator')
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 600, button: 0 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 400 })
    expect(shareShown()).toBe('0.70')
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 110 })
    expect(shareShown()).toBe('0.80')
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 110 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 900 })
    expect(shareShown()).toBe('0.80')
  })

  it('grows a panel on the start side when dragged towards the end', () => {
    render(<Harness panelSide="start" />)
    stubBounds()
    const handle = screen.getByRole('separator')
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 600, button: 0 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 400 })
    expect(shareShown()).toBe('0.30')
  })

  it('moves with the arrow keys, jumps to its limits with Home and End, and Enter restores the default', () => {
    render(<Harness panelSide="end" />)
    const handle = screen.getByRole('separator')
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(shareShown()).toBe('0.55')
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(shareShown()).toBe('0.45')
    fireEvent.keyDown(handle, { key: 'End' })
    expect(shareShown()).toBe('0.80')
    fireEvent.keyDown(handle, { key: 'Home' })
    expect(shareShown()).toBe('0.20')
    fireEvent.keyDown(handle, { key: 'Enter' })
    expect(shareShown()).toBe('0.50')
  })

  it('restores the default share on double-click', () => {
    render(<Harness panelSide="end" initial={0.3} />)
    fireEvent.doubleClick(screen.getByRole('separator'))
    expect(shareShown()).toBe('0.50')
  })
})
