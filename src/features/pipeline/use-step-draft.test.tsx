import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  STEP_COMMIT_DELAY_MS,
  useStepDraft,
} from '@/features/pipeline/use-step-draft'

describe('useStepDraft', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows an edit at once but commits it only after typing settles', () => {
    const commit = vi.fn()
    const { result } = renderHook(() => useStepDraft({ sigma: 1 }, commit))

    act(() => {
      result.current.change({ sigma: 2 })
    })
    expect(result.current.draft).toEqual({ sigma: 2 })
    expect(commit).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(STEP_COMMIT_DELAY_MS)
    })
    expect(commit).toHaveBeenCalledWith({ sigma: 2 })
  })

  it('commits a run of edits once, with the last', () => {
    const commit = vi.fn()
    const { result } = renderHook(() => useStepDraft({ sigma: 1 }, commit))

    for (const sigma of [2, 3, 4]) {
      act(() => {
        result.current.change({ sigma })
        vi.advanceTimersByTime(STEP_COMMIT_DELAY_MS / 4)
      })
    }
    act(() => {
      vi.advanceTimersByTime(STEP_COMMIT_DELAY_MS)
    })

    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith({ sigma: 4 })
  })

  it('commits straight away when flushed, as when a field loses focus', () => {
    const commit = vi.fn()
    const { result } = renderHook(() => useStepDraft({ sigma: 1 }, commit))
    act(() => {
      result.current.change({ sigma: 2 })
    })

    act(() => {
      result.current.flush()
    })

    expect(commit).toHaveBeenCalledWith({ sigma: 2 })
  })

  it('commits a waiting edit when the form closes', () => {
    const commit = vi.fn()
    const { result, unmount } = renderHook(() =>
      useStepDraft({ sigma: 1 }, commit),
    )
    act(() => {
      result.current.change({ sigma: 2 })
    })

    unmount()

    expect(commit).toHaveBeenCalledWith({ sigma: 2 })
  })

  it('takes a change made elsewhere, such as undo, as the new draft', () => {
    const commit = vi.fn()
    const { result, rerender } = renderHook(
      ({ committed }) => useStepDraft(committed, commit),
      { initialProps: { committed: { sigma: 1 } } },
    )

    rerender({ committed: { sigma: 5 } })

    expect(result.current.draft).toEqual({ sigma: 5 })
    expect(commit).not.toHaveBeenCalled()
  })

  it('keeps what is being typed when its own commit comes back', () => {
    const commit = vi.fn()
    const { result, rerender } = renderHook(
      ({ committed }) => useStepDraft(committed, commit),
      { initialProps: { committed: { sigma: 1 } } },
    )
    act(() => {
      result.current.change({ sigma: 2 })
      vi.advanceTimersByTime(STEP_COMMIT_DELAY_MS)
    })
    act(() => {
      result.current.change({ sigma: 3 })
    })

    rerender({ committed: { sigma: 2 } })

    expect(result.current.draft).toEqual({ sigma: 3 })
  })
})
