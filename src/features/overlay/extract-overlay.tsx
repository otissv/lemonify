import { useEffect, useRef } from 'react'

import { BoxEditor } from '@/features/overlay/box-editor'
import type { Box } from '@/features/overlay/box-geometry'
import {
  extractBox,
  hasExtractBox,
  withExtractBox,
} from '@/features/overlay/extract-box'
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
  const set = hasExtractBox(step.options)
  const seeded = useRef<string | undefined>(undefined)

  // biome-ignore lint/correctness/useExhaustiveDependencies: the step is given its region once, when the box first shows it
  useEffect(() => {
    if (set || seeded.current === step.id) return
    seeded.current = step.id
    setSharpOptions(documentId, step.id, withExtractBox(step.options, box))
  }, [set, documentId, step.id])

  function handleCommit(next: Box): void {
    setSharpOptions(documentId, step.id, withExtractBox(step.options, next))
  }

  return <BoxEditor label="Extract region" box={box} onCommit={handleCommit} />
}
