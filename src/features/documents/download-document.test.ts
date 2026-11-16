import { afterEach, describe, expect, it, vi } from 'vitest'

import { downloadDocument } from '@/features/documents/download-document'
import { settleDocument } from '@/features/documents/document-sync'

vi.mock('@/features/documents/document-sync', () => ({
  settleDocument: vi.fn(),
}))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('downloadDocument', () => {
  it('waits for the document’s edits to reach the server, then starts the download', async () => {
    const order: string[] = []
    let finish: () => void = () => {}
    vi.mocked(settleDocument).mockReturnValue(
      new Promise<void>((resolve) => {
        finish = () => {
          order.push('settled')
          resolve()
        }
      }),
    )
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        order.push(`click ${this.getAttribute('href')}`)
      })

    const started = downloadDocument('doc 1')
    expect(click).not.toHaveBeenCalled()
    finish()
    await started

    expect(order).toEqual(['settled', 'click /api/documents/doc%201/bundle'])
  })

  it('leaves no link behind in the page', async () => {
    vi.mocked(settleDocument).mockResolvedValue()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await downloadDocument('doc-1')

    expect(document.querySelector('a[download]')).toBeNull()
  })
})
