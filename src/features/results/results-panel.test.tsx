import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearUnusedResults } from '@/features/render/render-functions'
import type { ResultView } from '@/features/results/result'
import {
  deleteResult,
  getResultUsage,
  listResults,
} from '@/features/results/result-functions'
import { ResultsPanel } from '@/features/results/results-panel'
import { INITIAL_APP_STATE, useAppStore } from '@/store/app-store'
import { DOCUMENT_ID } from '@/test/document-fixtures'

vi.mock('@/features/results/result-functions', () => ({
  listResults: vi.fn(),
  deleteResult: vi.fn(),
  getResultUsage: vi.fn(),
}))
vi.mock('@/features/render/render-functions', () => ({
  clearUnusedResults: vi.fn(),
}))

const EXPORT: ResultView = {
  id: 'r1',
  kind: 'export',
  fileName: 'one.webp',
  mediaType: 'image/webp',
  bytes: 2_500_000,
  documentId: DOCUMENT_ID,
  stepId: null,
  workflowRunId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
}
const AI: ResultView = {
  ...EXPORT,
  id: 'r2',
  kind: 'ai-step',
  fileName: 'one-upscaled.png',
  stepId: 's1',
}

describe('ResultsPanel', () => {
  beforeEach(() => {
    useAppStore.setState(INITIAL_APP_STATE)
    vi.mocked(getResultUsage).mockResolvedValue({
      usedBytes: 5_000_000,
      maxBytes: 100_000_000,
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('says nothing is kept when there are no results', async () => {
    vi.mocked(listResults).mockResolvedValue([])
    render(<ResultsPanel documentId={DOCUMENT_ID} />)

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Nothing is kept for this image yet.',
    )
    expect(listResults).toHaveBeenCalledWith({
      data: { documentId: DOCUMENT_ID },
    })
  })

  it('lists each result with what made it, a download link and how much space is used', async () => {
    vi.mocked(listResults).mockResolvedValue([EXPORT, AI])
    render(<ResultsPanel documentId={DOCUMENT_ID} />)

    expect(
      await screen.findByRole('link', { name: 'Download one.webp' }),
    ).toHaveAttribute('href', '/api/results/r1')
    expect(screen.getByText('Export · 2.5 MB')).toBeVisible()
    expect(screen.getByText('AI step · 2.5 MB')).toBeVisible()
    expect(screen.getByText('5.0 MB of 100.0 MB used')).toBeVisible()
  })

  it('deletes a result and reads the list again', async () => {
    vi.mocked(listResults).mockResolvedValueOnce([EXPORT]).mockResolvedValue([])
    vi.mocked(deleteResult).mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<ResultsPanel documentId={DOCUMENT_ID} />)

    await user.click(
      await screen.findByRole('button', { name: 'Delete one.webp' }),
    )

    expect(deleteResult).toHaveBeenCalledWith({ data: { id: 'r1' } })
    await waitFor(() => {
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    })
  })

  it('clears the AI results the pipeline no longer uses and says how many went', async () => {
    vi.mocked(listResults).mockResolvedValue([AI])
    vi.mocked(clearUnusedResults).mockResolvedValue({ removed: 1 })
    const user = userEvent.setup()
    render(<ResultsPanel documentId={DOCUMENT_ID} />)

    await user.click(
      await screen.findByRole('button', { name: 'Clear unused AI results' }),
    )

    expect(clearUnusedResults).toHaveBeenCalledWith({
      data: { documentId: DOCUMENT_ID },
    })
    expect(await screen.findByText('Removed 1 unused AI result.')).toBeVisible()
  })

  it('shows why the list could not be read', async () => {
    vi.mocked(listResults).mockRejectedValue(new Error('Server is down.'))
    render(<ResultsPanel documentId={DOCUMENT_ID} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Server is down.',
    )
  })
})
