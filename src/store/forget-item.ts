import { useLibraryStore } from '@/store/library-store'
import { usePipelineStore } from '@/store/pipeline-store'
import { useUiStore } from '@/store/ui-store'

/** Drops everything every store holds about a document or workflow that no longer exists, so no store keeps a key for it. */
export function forgetItem(id: string): void {
  usePipelineStore.getState().forgetPipeline(id)
  useUiStore.getState().forgetUi(id)
  useLibraryStore.getState().forgetLibrary(id)
}
