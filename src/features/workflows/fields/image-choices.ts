import { createContext, useContext } from 'react'

import type { SourceSummary } from '@/features/documents/document'
import {
  sourceFileName,
  useSourcesStore,
} from '@/features/workflows/sources-store'

/**
 * The only images a control may offer as a second image. The editor sets it to
 * the images its pipeline has opened; without it (the workflow editor) any
 * uploaded image can be used.
 */
export const ImageChoicesContext = createContext<
  ReadonlyArray<SourceSummary> | undefined
>(undefined)

/** A function that gives an image's file name, from the offered images or else from every uploaded image. */
export function useImageNames(): (id: string) => string {
  const choices = useContext(ImageChoicesContext)
  const uploaded = useSourcesStore((state) => state.sources)
  return (id) => sourceFileName(choices ?? uploaded, id)
}
