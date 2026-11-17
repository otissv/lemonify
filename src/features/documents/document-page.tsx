import { useEffect } from 'react'

import type { AiCatalogues } from '@/features/ai/ai-defaults'
import type { AiToolSummary } from '@/features/ai/ai-tools'
import { DocumentView } from '@/features/documents/document-view'
import { DocumentNotices } from '@/features/documents/document-notices'
import { KeyBindings } from '@/features/keybindings/key-bindings'
import { MenuPanel } from '@/features/app/menu-panel'
import { usePreviewLoading } from '@/features/pipeline/use-preview'
import { ToolsPanel } from '@/features/tools/tools-panel'
import { useAppStore } from '@/store/app-store'

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
  const loaded = useAppStore((state) => state.documents[id] !== undefined)
  const visitDocument = useAppStore((state) => state.visitDocument)
  usePreviewLoading(id, true)

  useEffect(() => {
    visitDocument(id)
  }, [id, visitDocument])

  return (
    <div data-slot="tools-panel-bounds" className="relative size-full">
      <DocumentView id={id} />
      <KeyBindings documentId={id} catalogues={catalogues} />
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
