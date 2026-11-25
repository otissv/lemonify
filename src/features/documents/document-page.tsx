import { useEffect } from 'react'

import type { AiCatalogues } from '@/features/ai/ai-defaults'
import type { AiToolSummary } from '@/features/ai/ai-tools'
import { DocumentView } from '@/features/documents/document-view'
import { DocumentNotices } from '@/features/documents/document-notices'
import { Page } from '@/features/keybindings/actions'
import { KeyBindings } from '@/features/keybindings/key-bindings'
import { MenuPanel } from '@/features/app/menu-panel'
import { usePreviewLoading } from '@/features/pipeline/use-preview'
import { ToolsPanel } from '@/features/tools/tools-panel'
import { useUiStore } from '@/store/ui-store'
import { documentSession, usePipelineStore } from '@/store/pipeline-store'

interface DocumentPageProps {
  id: string
  tools: ReadonlyArray<AiToolSummary>
  catalogues: AiCatalogues
}

export function DocumentPage({
  id,
  tools,
  catalogues,
}: DocumentPageProps): React.JSX.Element {
  const loaded = usePipelineStore(
    (state) => documentSession(state, id) !== undefined,
  )
  const visitDocument = useUiStore((state) => state.visitItem)
  usePreviewLoading(id, true)

  useEffect(() => {
    visitDocument(id)
  }, [id, visitDocument])

  return (
    <div data-slot="tools-panel-bounds" className="relative size-full">
      <DocumentView id={id} />
      <KeyBindings
        page={Page.Document}
        documentId={id}
        catalogues={catalogues}
      />
      {loaded ? (
        <>
          <DocumentNotices documentId={id} />
          <ToolsPanel documentId={id} tools={tools} catalogues={catalogues} />
        </>
      ) : (
        <MenuPanel />
      )}
    </div>
  )
}
