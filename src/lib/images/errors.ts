/** Options failed schema validation; `issues` lists one readable line per problem. */
export class ImageOptionsError extends Error {
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    super(
      `Invalid image options:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`,
    )
    this.name = 'ImageOptionsError'
    this.issues = issues
  }
}

/** A source path is missing, unreadable, or not a supported image. */
export class ImageSourceError extends Error {
  readonly source: string

  constructor(source: string, reason: string, options?: ErrorOptions) {
    super(`Cannot process image source "${source}": ${reason}`, options)
    this.name = 'ImageSourceError'
    this.source = source
  }
}

/** Two sources would be written to the same output file. */
export class OutputCollisionError extends Error {
  constructor(output: string, first: string, second: string) {
    super(
      `"${first}" and "${second}" would both be written to "${output}". Rename one of them or process them separately.`,
    )
    this.name = 'OutputCollisionError'
  }
}

/** An upscale destination resolves to the source file it would overwrite. */
export class UpscaleTargetError extends Error {
  constructor(file: string) {
    super(
      `The destination resolves to the source file "${file}". Choose a different destination folder.`,
    )
    this.name = 'UpscaleTargetError'
  }
}

/** A model file could not be downloaded. */
export class ModelDownloadError extends Error {
  readonly url: string

  constructor(url: string, reason: string, options?: ErrorOptions) {
    super(`Cannot download model file "${url}": ${reason}`, options)
    this.name = 'ModelDownloadError'
    this.url = url
  }
}

/** A downloaded model file does not match its pinned SHA-256. */
export class ModelChecksumError extends Error {
  constructor(url: string, expected: string, actual: string) {
    super(
      `Model file "${url}" failed verification: expected SHA-256 ${expected}, got ${actual}. Nothing was written.`,
    )
    this.name = 'ModelChecksumError'
  }
}

/** The upscaler binary failed while processing an image. */
export class UpscaleEngineError extends Error {
  readonly source: string

  constructor(source: string, options?: ErrorOptions) {
    const reason =
      options?.cause instanceof Error ? options.cause.message : 'unknown error'
    super(`Upscaling "${source}" failed: ${reason}`, options)
    this.name = 'UpscaleEngineError'
    this.source = source
  }
}
