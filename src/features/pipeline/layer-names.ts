import type { LayerNames } from '@/features/pipeline/layer-kind-types'

/** What the page knows by name: the User's documents and workflows, and the images the pipeline uses. */
export interface NamedItems {
  documents: ReadonlyArray<{ id: string; name: string }>
  workflows: ReadonlyArray<{ id: string; name: string }>
  sources: ReadonlyArray<{ id: string; fileName: string }>
}

function lookupOf<Item extends { id: string }>(
  items: ReadonlyArray<Item>,
  name: (item: Item) => string,
): (id: string) => string | undefined {
  const byId = new Map<string, string>()
  for (const item of items) byId.set(item.id, name(item))
  return (id) => byId.get(id)
}

/** The names layer rows show for the images, documents and workflows their layers use. */
export function layerNames({
  documents,
  workflows,
  sources,
}: NamedItems): LayerNames {
  return {
    image: lookupOf(sources, (source) => source.fileName),
    document: lookupOf(documents, (document) => document.name),
    workflow: lookupOf(workflows, (workflow) => workflow.name),
  }
}
