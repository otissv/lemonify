import { sourceFileName, useLibraryStore } from '@/store/library-store'

/** A function that gives an uploaded image's file name from its id. */
export function useImageNames(): (id: string) => string {
  const uploaded = useLibraryStore((state) => state.sources)
  return (id) => sourceFileName(uploaded, id)
}
