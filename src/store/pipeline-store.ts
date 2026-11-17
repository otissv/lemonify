import { create } from 'zustand'

import type { DocumentView } from '@/features/documents/document'
import type {
  AiRun,
  DocumentPreview,
  DocumentThumbnails,
} from '@/features/documents/document-render'
import {
  newSession,
  shownPipeline,
  withConfirmed,
} from '@/features/pipeline/pipeline-session'
import type {
  DocumentSession,
  PendingOperation,
  PipelineOperation,
  PipelineSession,
  SessionView,
  WorkflowSession,
} from '@/features/pipeline/pipeline-session'
import type { Pipeline } from '@/features/pipeline/pipeline'
import type { WorkflowView } from '@/server/services/workflow-service'

type Keyed<T> = Readonly<Record<string, T | undefined>>

interface PipelineStateData {
  /** Every document and workflow open in this tab, by id; both are pipelines with an Edit history and are held, edited and synced the same way. */
  sessions: Keyed<PipelineSession>
  /** What was made of each pipeline: the picture, the small step pictures and the AI step running. */
  previews: Keyed<DocumentPreview>
  thumbnails: Keyed<DocumentThumbnails>
  aiRuns: Keyed<AiRun>
  nextOperationId: number
}

interface PipelineStateActions {
  /** Replaces what the server confirmed; waiting operations are dropped when `reset`. */
  confirmDocument: (view: DocumentView, reset: boolean) => void
  confirmWorkflow: (view: WorkflowView, reset: boolean) => void
  /** Takes a newer state from the server and keeps `pending`, the waiting operations made again on top of it. */
  rebaseSession: (
    update: SessionView,
    pending: ReadonlyArray<PendingOperation>,
    error: string | undefined,
  ) => void
  queueOperation: (id: string, op: PipelineOperation) => void
  /** The server accepted the first waiting operation. */
  settleOperation: (update: SessionView) => void
  setSyncing: (id: string, syncing: boolean) => void
  failSession: (id: string, error: string) => void
  setSessionError: (id: string, error: string) => void
  clearSessionError: (id: string) => void
  setPreview: (id: string, preview: DocumentPreview) => void
  setThumbnails: (id: string, thumbnails: DocumentThumbnails) => void
  setAiRun: (id: string, run: AiRun | undefined) => void
  /** Drops the session and everything rendered from it. */
  forgetPipeline: (id: string) => void
}

export type PipelineState = PipelineStateData & PipelineStateActions

export const INITIAL_PIPELINE_STATE: Readonly<PipelineStateData> = {
  sessions: {},
  previews: {},
  thumbnails: {},
  aiRuns: {},
  nextOperationId: 1,
}

/** The pipeline on screen for a document or workflow, or undefined until it has loaded. */
export function currentPipeline(
  state: Pick<PipelineStateData, 'sessions'>,
  id: string,
): Pipeline | undefined {
  const session = state.sessions[id]
  return session ? shownPipeline(session) : undefined
}

/** The session of a document, or undefined when it is not open or is something else. */
export function documentSession(
  state: Pick<PipelineStateData, 'sessions'>,
  id: string,
): DocumentSession | undefined {
  const session = state.sessions[id]
  return session?.kind === 'document' ? session : undefined
}

/** The session of a workflow, or undefined when it is not open or is something else. */
export function workflowSession(
  state: Pick<PipelineStateData, 'sessions'>,
  id: string,
): WorkflowSession | undefined {
  const session = state.sessions[id]
  return session?.kind === 'workflow' ? session : undefined
}

function withSession(
  sessions: PipelineStateData['sessions'],
  id: string,
  update: (session: PipelineSession) => PipelineSession,
): Pick<PipelineStateData, 'sessions'> | Record<string, never> {
  const session = sessions[id]
  if (!session) return {}
  return { sessions: { ...sessions, [id]: update(session) } }
}

function without<T>(
  record: Keyed<T>,
  id: string,
): Record<string, T | undefined> {
  const { [id]: _removed, ...rest } = record
  return rest
}

function confirmed(
  sessions: PipelineStateData['sessions'],
  update: SessionView,
  reset: boolean,
): Pick<PipelineStateData, 'sessions'> {
  const held = sessions[update.view.id]
  return {
    sessions: {
      ...sessions,
      [update.view.id]: newSession(update, {
        pending: reset || !held ? [] : held.pending,
        syncing: false,
        error: held?.error,
      }),
    },
  }
}

/**
 * The documents and workflows open in this tab and what is rendered from them.
 * A document and a workflow are the same thing to this store: a pipeline whose
 * edits are queued, confirmed by the server and undone from its Edit history.
 */
export const usePipelineStore = create<PipelineState>()((set) => ({
  ...INITIAL_PIPELINE_STATE,
  confirmDocument: (view, reset) => {
    set(({ sessions }) =>
      confirmed(sessions, { kind: 'document', view }, reset),
    )
  },
  confirmWorkflow: (view, reset) => {
    set(({ sessions }) =>
      confirmed(sessions, { kind: 'workflow', view }, reset),
    )
  },
  rebaseSession: (update, pending, error) => {
    set(({ sessions }) =>
      withSession(sessions, update.view.id, (session) =>
        withConfirmed(session, update, { pending, error }),
      ),
    )
  },
  queueOperation: (id, op) => {
    set(({ sessions, nextOperationId }) => ({
      ...withSession(sessions, id, (session) => ({
        ...session,
        error: undefined,
        pending: [...session.pending, { id: nextOperationId, op }],
      })),
      nextOperationId: nextOperationId + 1,
    }))
  },
  settleOperation: (update) => {
    set(({ sessions }) =>
      withSession(sessions, update.view.id, (session) =>
        withConfirmed(session, update, { pending: session.pending.slice(1) }),
      ),
    )
  },
  setSyncing: (id, syncing) => {
    set(({ sessions }) =>
      withSession(sessions, id, (session) => ({ ...session, syncing })),
    )
  },
  failSession: (id, error) => {
    set(({ sessions }) =>
      withSession(sessions, id, (session) => ({
        ...session,
        pending: [],
        syncing: false,
        error,
      })),
    )
  },
  setSessionError: (id, error) => {
    set(({ sessions }) =>
      withSession(sessions, id, (session) => ({ ...session, error })),
    )
  },
  clearSessionError: (id) => {
    set(({ sessions }) =>
      withSession(sessions, id, (session) => ({
        ...session,
        error: undefined,
      })),
    )
  },
  setPreview: (id, preview) => {
    set(({ previews }) => ({ previews: { ...previews, [id]: preview } }))
  },
  setThumbnails: (id, thumbnails) => {
    set((state) => ({
      thumbnails: { ...state.thumbnails, [id]: thumbnails },
    }))
  },
  setAiRun: (id, run) => {
    set(({ aiRuns }) => ({ aiRuns: { ...aiRuns, [id]: run } }))
  },
  forgetPipeline: (id) => {
    set((state) => ({
      sessions: without(state.sessions, id),
      previews: without(state.previews, id),
      thumbnails: without(state.thumbnails, id),
      aiRuns: without(state.aiRuns, id),
    }))
  },
}))
