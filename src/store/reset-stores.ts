import { INITIAL_LIBRARY_STATE, useLibraryStore } from '@/store/library-store'
import {
  INITIAL_PIPELINE_STATE,
  usePipelineStore,
} from '@/store/pipeline-store'
import { INITIAL_UI_STATE, useUiStore } from '@/store/ui-store'

/** Puts every store back as it starts, so a test begins from nothing. */
export function resetStores(): void {
  useUiStore.setState(INITIAL_UI_STATE)
  usePipelineStore.setState(INITIAL_PIPELINE_STATE)
  useLibraryStore.setState(INITIAL_LIBRARY_STATE)
}
