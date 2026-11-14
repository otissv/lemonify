function reasonOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** Sharp rejected an op's arguments or failed while processing; `context` says which op or file. */
export class SharpOperationError extends Error {
  readonly context: string

  constructor(context: string, cause: unknown) {
    super(`${context}: ${reasonOf(cause)}`, { cause })
    this.name = 'SharpOperationError'
    this.context = context
  }
}

/** A folder job would write an output over one of its own source files. */
export class SharpTargetError extends Error {
  constructor(file: string) {
    super(
      `The output for "${file}" resolves to the file itself. Choose a different output folder.`,
    )
    this.name = 'SharpTargetError'
  }
}

/** An in-place job's format op would write a file in a different format than its extension. */
export class InPlaceFormatError extends Error {
  constructor(file: string, current: string, requested: string) {
    super(
      `Writing "${file}" in place would change it from ${current} to ${requested}. Use output to convert it to a new file.`,
    )
    this.name = 'InPlaceFormatError'
  }
}
