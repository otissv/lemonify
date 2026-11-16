import { useEffect, useRef, useState } from 'react'

import { Input } from '@/components/ui/input'
import { MAX_DOCUMENT_NAME_LENGTH } from '@/features/documents/document'

interface DocumentNameInputProps {
  name: string
  /** Called with the new name, trimmed, when it is a different, non-empty name. */
  onCommit: (name: string) => void
  /** Called when the edit ends with no change. */
  onCancel: () => void
}

/** Renames a document in place: Enter or leaving the field keeps the name, Escape drops the edit. */
export function DocumentNameInput({
  name,
  onCommit,
  onCancel,
}: DocumentNameInputProps): React.JSX.Element {
  const [text, setText] = useState(name)
  const field = useRef<HTMLInputElement>(null)
  const finished = useRef(false)

  useEffect(() => {
    field.current?.focus()
    field.current?.select()
  }, [])

  function finish(keep: boolean): void {
    if (finished.current) return
    finished.current = true
    const next = text.trim()
    if (keep && next !== '' && next !== name) onCommit(next)
    else onCancel()
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') finish(true)
    if (event.key === 'Escape') finish(false)
  }

  return (
    <Input
      ref={field}
      aria-label="Document name"
      value={text}
      maxLength={MAX_DOCUMENT_NAME_LENGTH}
      className="h-7 flex-1"
      onChange={(event) => {
        setText(event.target.value)
      }}
      onKeyDown={handleKeyDown}
      onBlur={() => {
        finish(true)
      }}
    />
  )
}
