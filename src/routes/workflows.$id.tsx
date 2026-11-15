import { createFileRoute } from '@tanstack/react-router'

import { loadAiToolEntries } from '@/features/workflows/ai-tool-entries'
import { WorkflowPage } from '@/features/workflows/workflow-page'

export const Route = createFileRoute('/workflows/$id')({
  loader: () => loadAiToolEntries(),
  staleTime: Infinity,
  component: WorkflowRoutePage,
})

function WorkflowRoutePage(): React.JSX.Element {
  const { id } = Route.useParams()
  const aiTools = Route.useLoaderData()
  return <WorkflowPage key={id} id={id} aiTools={aiTools} />
}
