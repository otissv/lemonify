import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { downloadDocument } from '@/features/documents/download-document'
import type { DownloadProgress } from '@/features/documents/download-document'
import {
  SAVED_NOTICE_MS,
  useExportDocument,
} from '@/features/documents/use-export-document'

vi.mock('@/features/documents/download-document', () => ({
  downloadDocument: vi.fn(),
}))

type Gate = { release: (name: string) => void; fail: (error: Error) => void }

/** A download that waits until the test lets it finish, and tells what it has received so far. */
function heldDownload(progress?: DownloadProgress): Gate {
  let release: (name: string) => void = () => {}
  let fail: (error: Error) => void = () => {}
  vi.mocked(downloadDocument).mockImplementation(
    (_id, onProgress) =>
      new Promise<string>((resolve, reject) => {
        if (progress) onProgress(progress)
        release = resolve
        fail = reject
      }),
  )
  return { release: (name) => release(name), fail: (error) => fail(error) }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})

describe('useExportDocument', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => useExportDocument())

    expect(result.current.status).toEqual({ kind: 'idle' })
    expect(result.current.error).toBeNull()
  })

  it('says it is preparing until the file starts to arrive, then how much has', async () => {
    const gate = heldDownload({ loaded: 1024, total: 2048 })
    const { result } = renderHook(() => useExportDocument())

    act(() => {
      void result.current.exportDocument('d1')
    })

    expect(result.current.status).toEqual({
      kind: 'saving',
      loaded: 1024,
      total: 2048,
    })
    await act(async () => gate.release('kant.lemon'))
  })

  it('is preparing before any of the file has arrived', async () => {
    const gate = heldDownload()
    const { result } = renderHook(() => useExportDocument())

    act(() => {
      void result.current.exportDocument('d1')
    })

    expect(result.current.status).toEqual({ kind: 'preparing' })
    await act(async () => gate.release('kant.lemon'))
  })

  it('says where it saved, then clears the notice by itself', async () => {
    const gate = heldDownload()
    const { result } = renderHook(() => useExportDocument())
    act(() => {
      void result.current.exportDocument('d1')
    })

    await act(async () => gate.release('kant.lemon'))
    expect(result.current.status).toEqual({
      kind: 'saved',
      fileName: 'kant.lemon',
    })
    act(() => {
      vi.advanceTimersByTime(SAVED_NOTICE_MS)
    })

    expect(result.current.status).toEqual({ kind: 'idle' })
  })

  it('keeps the reason a save failed, and clears it on the next try', async () => {
    const gate = heldDownload()
    const { result } = renderHook(() => useExportDocument())
    act(() => {
      void result.current.exportDocument('d1')
    })

    await act(async () => gate.fail(new Error('That image does not exist.')))
    expect(result.current.error).toBe('That image does not exist.')
    expect(result.current.status).toEqual({ kind: 'idle' })

    heldDownload()
    act(() => {
      void result.current.exportDocument('d1')
    })
    expect(result.current.error).toBeNull()
  })

  it('does not start a second save while one is running', async () => {
    const gate = heldDownload()
    const { result } = renderHook(() => useExportDocument())

    act(() => {
      void result.current.exportDocument('d1')
      void result.current.exportDocument('d1')
    })

    expect(downloadDocument).toHaveBeenCalledTimes(1)
    await act(async () => gate.release('kant.lemon'))
  })

  it('stops its timer when the page goes away', async () => {
    const gate = heldDownload()
    const { result, unmount } = renderHook(() => useExportDocument())
    act(() => {
      void result.current.exportDocument('d1')
    })
    await act(async () => gate.release('kant.lemon'))

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
