import { BoxEditor } from '@/features/overlay/box-editor'
import type { Box } from '@/features/overlay/box-geometry'
import { extractBox, withExtractBox } from '@/features/overlay/extract-box'
import { useOverlay } from '@/features/overlay/overlay-context'
import type { OverlayToolProps } from '@/features/overlay/overlay-tools'
import { setSharpOptions } from '@/features/pipeline/pipeline-actions'

/** The region an extract step takes, drawn on the picture it takes it from. */
export function ExtractOverlay({
  documentId,
  step,
}: OverlayToolProps): React.JSX.Element {
  const { size } = useOverlay()
  const box = extractBox(step.options, size)

  function handleCommit(next: Box): void {
    setSharpOptions(documentId, step.id, withExtractBox(step.options, next))
  }

  return <BoxEditor label="Extract region" box={box} onCommit={handleCommit} />
}
