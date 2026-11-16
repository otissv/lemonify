import {
  sourceFileName,
  useSourcesStore,
} from '@/features/workflows/sources-store'

/** A function that gives an uploaded image's file name from its id. */
export function useImageNames(): (id: string) => string {
  const uploaded = useSourcesStore((state) => state.sources)
  return (id) => sourceFileName(uploaded, id)
}
