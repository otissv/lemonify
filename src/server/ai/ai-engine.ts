import type { AiCatalogue, AiSettings, AiToolId } from '@/features/ai/ai-tools'

/** One image for an AI tool: where to read it and where to write the finished PNG. */
export interface AiImageRequest {
  /** Names the image in the answer; unique within a batch. */
  id: string
  input: string
  output: string
}

/** Images that share a tool and settings, so an engine can load its model once for all of them. */
export interface AiBatch {
  tool: AiToolId
  settings: AiSettings
  requests: ReadonlyArray<AiImageRequest>
}

export interface AiImageResult {
  id: string
  width: number
  height: number
}

export interface RunningAi {
  result: Promise<ReadonlyArray<AiImageResult>>
  /** Stops the work; `result` then rejects with `AiCancelledError`. */
  cancel(): void
}

/** Called with how much of the batch is done, from 0 to 1. */
export type AiProgressListener = (fraction: number) => void

/** Runs AI tools. One adapter exists per tool family; Upscayl is the first. */
export interface AiEngine {
  run(batch: AiBatch, onProgress: AiProgressListener): RunningAi
  /** The models a tool offers and its default, for the Tools panel and the CLI. */
  catalogue(tool: AiToolId): Promise<AiCatalogue>
}

/** The AI tool stopped before it finished because it was cancelled. */
export class AiCancelledError extends Error {
  constructor() {
    super('The AI step was cancelled.')
    this.name = 'AiCancelledError'
  }
}

/** The AI tool could not process the images; the message says why in plain words. */
export class AiEngineError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AiEngineError'
  }
}
