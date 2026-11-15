import { createFileRoute } from '@tanstack/react-router'

import type { AiCatalogues } from '@/features/ai/ai-defaults'
import { getAiCatalogue, listAiTools } from '@/features/ai/ai-functions'
import { DocumentPage } from '@/features/documents/document-page'

export const Route = createFileRoute('/documents/$id')({
  loader: async () => {
    const tools = await listAiTools()
    const catalogues: AiCatalogues = await Promise.all(
      tools.map(async ({ id }) => ({
        tool: id,
        catalogue: await getAiCatalogue({ data: { tool: id } }),
      })),
    )
    return { tools, catalogues }
  },
  staleTime: Infinity,
  component: DocumentRoutePage,
})

function DocumentRoutePage(): React.JSX.Element {
  const { id } = Route.useParams()
  const { tools, catalogues } = Route.useLoaderData()
  return <DocumentPage id={id} tools={tools} catalogues={catalogues} />
}
