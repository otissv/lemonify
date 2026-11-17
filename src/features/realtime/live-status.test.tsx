import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  LiveStatus,
  RECONNECTING_MESSAGE,
  RECONNECT_NOTICE_DELAY_MS,
} from '@/features/realtime/live-status'
import { RealtimeStatus } from '@/features/realtime/realtime-client'
import { useUiStore } from '@/store/ui-store'
import { resetStores } from '@/store/reset-stores'

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  resetStores()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('LiveStatus', () => {
  it('says nothing while all is well', () => {
    useUiStore.setState({ realtime: RealtimeStatus.Open })
    render(<LiveStatus />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('says nothing about a short loss of connection', () => {
    useUiStore.setState({ realtime: RealtimeStatus.Reconnecting })
    render(<LiveStatus />)

    act(() => vi.advanceTimersByTime(RECONNECT_NOTICE_DELAY_MS - 1))

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('says it is reconnecting after a longer one, and stops saying so when back', () => {
    useUiStore.setState({ realtime: RealtimeStatus.Reconnecting })
    render(<LiveStatus />)

    act(() => vi.advanceTimersByTime(RECONNECT_NOTICE_DELAY_MS))
    expect(screen.getByRole('status')).toHaveTextContent(RECONNECTING_MESSAGE)

    act(() => useUiStore.setState({ realtime: RealtimeStatus.Open }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows a notice until it is dismissed', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    useUiStore.setState({ liveNotice: 'It was deleted.' })
    render(<LiveStatus />)

    expect(screen.getByRole('status')).toHaveTextContent('It was deleted.')
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(useUiStore.getState().liveNotice).toBeUndefined()
  })
})
