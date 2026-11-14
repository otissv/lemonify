import sharp from 'sharp'

export interface FormatCapability {
  id: string
  input: {
    file: boolean
    buffer: boolean
    stream: boolean
    fileSuffix: string[]
  }
  output: { file: boolean; buffer: boolean; stream: boolean; alias: string[] }
}

export interface Capabilities {
  versions: Record<string, string | undefined>
  simd: boolean
  concurrency: number
  formats: FormatCapability[]
}

/** What this Sharp build can read and write, for agents and GUIs to discover before building a job. */
export function describeCapabilities(): Capabilities {
  const formats: FormatCapability[] = []
  for (const format of Object.values(sharp.format)) {
    formats.push({
      id: format.id,
      input: {
        file: format.input.file,
        buffer: format.input.buffer,
        stream: format.input.stream,
        fileSuffix: format.input.fileSuffix ?? [],
      },
      output: {
        file: format.output.file,
        buffer: format.output.buffer,
        stream: format.output.stream,
        alias: format.output.alias ?? [],
      },
    })
  }
  return {
    versions: { ...sharp.versions },
    simd: sharp.simd(),
    concurrency: sharp.concurrency(),
    formats,
  }
}

/** Lower-case file extensions Sharp can read from disk in this build. */
export function readableExtensions(): string[] {
  const extensions = new Set<string>()
  for (const format of describeCapabilities().formats) {
    if (!format.input.file) continue
    for (const suffix of format.input.fileSuffix)
      extensions.add(suffix.toLowerCase())
  }
  return [...extensions].sort()
}
