import { create } from 'zustand'
import { z } from 'zod'

import type { SourceSummary } from '@/features/documents/document'
import { deleteSource, listSources } from '@/features/sources/source-functions'
import { errorMessage } from '@/lib/error-message'

export enum SourcesStatus {
  Idle = 'idle',
  Loading = 'loading',
  Ready = 'ready',
  Failed = 'failed',
}

const UPLOAD_ENDPOINT = '/api/sources'
const LOAD_FAILED = 'Your images could not be loaded.'
const UPLOAD_FAILED = 'The image could not be uploaded.'

const UploadResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      fileName: z.string(),
      mediaType: z.string(),
      bytes: z.number(),
      width: z.number(),
      height: z.number(),
    }),
  ),
  error: z.string(),
})

interface SourcesState {
  sources: ReadonlyArray<SourceSummary>
  status: SourcesStatus
  error: string | null
  load: () => Promise<void>
  upload: (file: File) => Promise<SourceSummary>
  /** Deletes an image nothing uses, and takes it out of the list. */
  remove: (id: string) => Promise<void>
}

export const INITIAL_SOURCES_STATE = {
  sources: [],
  status: SourcesStatus.Idle,
  error: null,
} as const

/**
 * The User's uploaded images, shared by every control that chooses one.
 * Uploading is `POST /api/sources` with the raw bytes; the same image
 * uploaded twice is the same Source, so it is added to the list only once.
 */
export const useSourcesStore = create<SourcesState>()((set, get) => ({
  ...INITIAL_SOURCES_STATE,
  load: async () => {
    if (get().status === SourcesStatus.Loading) return
    set({ status: SourcesStatus.Loading, error: null })
    try {
      set({ sources: await listSources(), status: SourcesStatus.Ready })
    } catch (caught) {
      set({
        status: SourcesStatus.Failed,
        error: errorMessage(caught, LOAD_FAILED),
      })
    }
  },
  upload: async (file) => {
    const response = await fetch(UPLOAD_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': file.type,
        'X-File-Name': encodeURIComponent(file.name),
      },
      body: file,
    })
    const parsed = UploadResponseSchema.safeParse(await response.json())
    const source = parsed.success ? parsed.data.data.at(0) : undefined
    if (!response.ok || source === undefined) {
      throw new Error(
        parsed.success && parsed.data.error ? parsed.data.error : UPLOAD_FAILED,
      )
    }
    set(({ sources }) => ({
      sources: sources.some(({ id }) => id === source.id)
        ? sources
        : [source, ...sources],
    }))
    return source
  },
  remove: async (id) => {
    await deleteSource({ data: { id } })
    set(({ sources }) => ({
      sources: sources.filter((source) => source.id !== id),
    }))
  },
}))

/** The file name of a Source, or a placeholder while the list is loading or the Source is gone. */
export function sourceFileName(
  sources: ReadonlyArray<SourceSummary>,
  id: string,
): string {
  return sources.find((source) => source.id === id)?.fileName ?? 'Unknown image'
}
