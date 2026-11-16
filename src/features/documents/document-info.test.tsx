import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { DocumentInfo } from '@/features/documents/document-info'
import {
  createAiStep,
  createLayerStep,
  createSharpStep,
} from '@/features/pipeline/pipeline'
import { AiToolId } from '@/features/ai/ai-tools'
import { INITIAL_APP_STATE, useAppStore } from '@/store/app-store'
import {
  DOCUMENT_ID,
  documentView,
  loadDocumentIntoEditor,
} from '@/test/document-fixtures'

const UPSCALE = createAiStep({
  tool: AiToolId.Upscale,
  settings: { model: 'm', scale: 4, iterations: 1, tta: false },
})

beforeEach(() => {
  useAppStore.setState(INITIAL_APP_STATE)
})

function show(): void {
  render(<DocumentInfo documentId={DOCUMENT_ID} />)
}

function value(term: string): string | null {
  const row = screen.getByText(term).closest('div')
  return row?.querySelector('dd')?.textContent ?? null
}

describe('DocumentInfo', () => {
  it('lists the document and its image', () => {
    loadDocumentIntoEditor(documentView())

    show()

    expect(screen.getByRole('heading', { name: 'Document' })).toBeVisible()
    expect(value('Name')).toBe('one.png')
    expect(value('Canvas image')).toBe('one.png')
    expect(value('Canvas size')).toBe('10 × 10 px')
    expect(value('Canvas type')).toBe('PNG')
    expect(value('File size')).toBe('100 B')
    expect(value('Id')).toBe(DOCUMENT_ID)
  })

  it('counts the steps by kind', () => {
    loadDocumentIntoEditor(
      documentView([
        createSharpStep('blur'),
        createSharpStep('flip'),
        createLayerStep('logo'),
        UPSCALE,
      ]),
    )

    show()

    expect(value('Steps')).toBe('5')
    expect(value('Layers')).toBe('2')
    expect(value('Effects')).toBe('2')
    expect(value('AI steps')).toBe('1')
  })

  it('says when it was made and last changed, and which revision it is', () => {
    loadDocumentIntoEditor({ ...documentView(), revision: 7 })

    show()

    expect(value('Created')).toMatch(/2026/)
    expect(value('Last changed')).toMatch(/2026/)
    expect(value('Revision')).toBe('7')
  })

  it('says so when there is no canvas image', () => {
    const view = documentView()
    loadDocumentIntoEditor({ ...view, source: null, sources: [] })

    show()

    expect(value('Canvas image')).toBe('None')
    expect(screen.queryByText('Canvas size')).not.toBeInTheDocument()
  })

  it('shows nothing while the document is not open', () => {
    show()

    expect(screen.queryByRole('heading', { name: 'Document' })).toBeNull()
  })
})
