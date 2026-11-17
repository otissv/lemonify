import { useNavigate, useRouter } from '@tanstack/react-router'
import { useCallback, useId, useState } from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CanvasForm } from '@/features/documents/canvas-form'
import { createBlankDocument } from '@/features/documents/document-functions'
import { canvasOfSize } from '@/features/pipeline/canvas'
import type { Canvas } from '@/features/pipeline/canvas'
import { errorMessage } from '@/lib/error-message'
import { useUiStore } from '@/store/ui-store'

const DEFAULT_NAME = 'Untitled'
const DEFAULT_WIDTH = 1920
const DEFAULT_HEIGHT = 1080
const CREATE_FAILED = 'The document could not be made.'
const INITIAL_CANVAS = canvasOfSize(DEFAULT_WIDTH, DEFAULT_HEIGHT)

/** Makes a document with nothing in it, on a canvas the person sizes. */
export function NewDocumentDialog(): React.JSX.Element {
  const open = useUiStore((state) => state.newDocumentOpen)
  const setOpen = useUiStore((state) => state.setNewDocumentOpen)
  const router = useRouter()
  const navigate = useNavigate()
  const [name, setName] = useState(DEFAULT_NAME)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const nameId = useId()

  const handleOpenChange = useCallback(
    (next: boolean): void => {
      setOpen(next)
      if (!next) setError(undefined)
    },
    [setOpen],
  )

  function handleName(event: React.ChangeEvent<HTMLInputElement>): void {
    setName(event.target.value)
  }

  const handleSubmit = useCallback(
    (canvas: Canvas): void => {
      setBusy(true)
      setError(undefined)
      void (async () => {
        try {
          const document = await createBlankDocument({ data: { name, canvas } })
          setOpen(false)
          await router.invalidate()
          await navigate({ to: '/documents/$id', params: { id: document.id } })
        } catch (caught) {
          setError(errorMessage(caught, CREATE_FAILED))
        } finally {
          setBusy(false)
        }
      })()
    },
    [name, navigate, router, setOpen],
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New document</DialogTitle>
          <DialogDescription>
            Start with an empty canvas of the size you choose. Add images to it
            as layers.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          <Label htmlFor={nameId}>Name</Label>
          <Input
            id={nameId}
            autoComplete="off"
            value={name}
            disabled={busy}
            onChange={handleName}
          />
        </div>
        <CanvasForm
          initial={INITIAL_CANVAS}
          submitLabel="Create document"
          onSubmit={handleSubmit}
          disabled={busy || name.trim() === ''}
          error={error}
        />
      </DialogContent>
    </Dialog>
  )
}
