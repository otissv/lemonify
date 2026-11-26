import { getRouteApi } from '@tanstack/react-router'
import { createContext, useContext, useMemo } from 'react'

import type { SourceSummary } from '@/features/documents/document'
import type { LayerNames } from '@/features/pipeline/layer-kinds'
import { layerNames } from '@/features/pipeline/layer-names'
import type { NamedItems } from '@/features/pipeline/layer-names'

const rootRoute = getRouteApi('__root__')

/** The User's documents and workflows by name, for what layers use. */
export type ItemNames = Omit<NamedItems, 'sources'>

const NO_ITEMS: ItemNames = { documents: [], workflows: [] }

export const ItemNamesContext = createContext<ItemNames>(NO_ITEMS)

/** Gives the pages the User's documents and workflows as the app's lists hold them, which are read again when one is made, renamed or deleted. */
export function ItemNamesProvider({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const { documents, workflows } = rootRoute.useLoaderData()
  const value = useMemo(
    () => ({ documents, workflows }),
    [documents, workflows],
  )
  return <ItemNamesContext value={value}>{children}</ItemNamesContext>
}

/** The names of what layers use: the User's documents and workflows, and `sources`. */
export function useLayerNames(
  sources: ReadonlyArray<SourceSummary> | undefined,
): LayerNames {
  const { documents, workflows } = useContext(ItemNamesContext)
  return useMemo(
    () => layerNames({ documents, workflows, sources: sources ?? [] }),
    [documents, workflows, sources],
  )
}
