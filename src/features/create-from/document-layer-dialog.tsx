import { useCallback } from 'react'

import { ChoiceField } from '@/features/create-from/choice-field'
import { CreateFromShell } from '@/features/create-from/create-from-shell'
import { addUsedLayer } from '@/features/create-from/add-used-layer'
import { useItemChoices } from '@/features/create-from/use-item-choices'
import { listDocuments } from '@/features/documents/document-functions'
import { createDocumentLayerStep } from '@/features/pipeline/layer-kinds'
import { useUiStore } from '@/store/ui-store'

const LOAD_FAILED = 'Your documents could not be loaded.'
const NO_DOCUMENTS = 'You have no other documents yet.'

interface UsedLayerDialogProps {
  /** The document or workflow the layer goes in. */
  itemId: string
  /** The step it goes after; the end when none. */
  afterStepId?: string
}

/** Adds a layer that draws another of the User's documents as it is now, and as it changes. */
export function DocumentLayerDialog({
  itemId,
  afterStepId,
}: UsedLayerDialogProps): React.JSX.Element {
  const setCreateFrom = useUiStore((state) => state.setCreateFrom)
  const documents = useItemChoices({
    load: listDocuments,
    exclude: itemId,
    loadFailed: LOAD_FAILED,
    none: NO_DOCUMENTS,
  })
  const documentId = documents.chosen

  const handleOpenChange = useCallback(
    (open: boolean): void => {
      if (!open) setCreateFrom(undefined)
    },
    [setCreateFrom],
  )

  const handleSubmit = useCallback((): void => {
    if (documentId === '') return
    addUsedLayer(itemId, createDocumentLayerStep(documentId), afterStepId)
    setCreateFrom(undefined)
  }, [afterStepId, documentId, itemId, setCreateFrom])

  return (
    <CreateFromShell
      title="Add document layer"
      description="Adds a layer that draws the document at its own canvas size. It changes when the document does."
      submitLabel="Add"
      problem={documents.problem}
      busy={documents.loading || documentId === ''}
      onOpenChange={handleOpenChange}
      onSubmit={handleSubmit}
    >
      <ChoiceField
        label="Document"
        value={documentId}
        choices={documents.choices}
        disabled={documents.loading}
        onChange={documents.choose}
      />
    </CreateFromShell>
  )
}

export type { UsedLayerDialogProps }
