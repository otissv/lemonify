import { useEffect } from 'react'

import { redoEdit, undoEdit } from '@/features/documents/document-sync'

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  )
}

/**
 * Ctrl/Cmd+Z undoes and Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redoes the document's
 * edits. Left alone while a text field has focus, where the same keys undo
 * the typing.
 */
export function useUndoShortcuts(documentId: string): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || isTextEntry(event.target)) return
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) void undoEdit(documentId)
      else if ((key === 'z' && event.shiftKey) || key === 'y') {
        void redoEdit(documentId)
      } else return
      event.preventDefault()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [documentId])
}
