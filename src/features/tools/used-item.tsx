import { useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'

import { Button } from '@/components/ui/button'
import { convertLayer } from '@/features/create-from/convert-layer'
import type { UsedItem } from '@/features/pipeline/layer-kinds'

interface UsedItemSummaryProps {
  /** The item's name, or undefined when it is gone. */
  name: string | undefined
  /** What to say when it is gone. */
  missing: string
  /** What the layer does with the item, shown under its name. */
  children?: React.ReactNode
  /** Shown beside the name while the item is there, such as a way to open it. */
  action?: React.ReactNode
}

/** The document or workflow a layer uses: its name or that it is gone, and what the layer does with it. */
export function UsedItemSummary({
  name,
  missing,
  children,
  action,
}: UsedItemSummaryProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span
          className={
            name === undefined
              ? 'truncate text-body-md text-destructive'
              : 'truncate text-body-md'
          }
        >
          {name ?? missing}
        </span>
        {name !== undefined && action}
      </div>
      {children}
    </div>
  )
}

interface OpenUsedItemProps {
  item: UsedItem
  name: string
}

/** Goes to the editor of the document or workflow a layer uses. */
export function useOpenUsedItem(item: UsedItem): () => void {
  const navigate = useNavigate()
  return useCallback((): void => {
    if (item.kind === 'document') {
      void navigate({ to: '/documents/$id', params: { id: item.documentId } })
      return
    }
    void navigate({ to: '/workflows/$id', params: { id: item.workflowId } })
  }, [item, navigate])
}

/** Opens the document or workflow a layer uses, to change it there. */
export function OpenUsedItem({
  item,
  name,
}: OpenUsedItemProps): React.JSX.Element {
  const handleOpen = useOpenUsedItem(item)

  return (
    <Button
      variant="secondary"
      size="sm"
      aria-label={`Open ${name}`}
      onClick={handleOpen}
    >
      Open
    </Button>
  )
}

interface ConvertToEmbeddedProps {
  /** The open document or workflow the layer is in. */
  itemId: string
  stepId: string
}

/** Turns the layer into an embedded document layer holding a copy of what it uses, so this one place can change on its own. */
export function ConvertToEmbedded({
  itemId,
  stepId,
}: ConvertToEmbeddedProps): React.JSX.Element {
  function handleConvert(): void {
    void convertLayer(itemId, stepId)
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      className="h-auto w-full whitespace-normal py-1.5"
      onClick={handleConvert}
    >
      Convert to embedded document layer
    </Button>
  )
}
