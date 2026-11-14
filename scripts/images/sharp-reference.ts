import { format, resolveConfig } from 'prettier'

/** Where the generated Sharp job reference lives, relative to the project root. */
export const SHARP_REFERENCE_FILE = 'doc/cli-sharp-reference.md'

/** Formats the generated Markdown with the project's Prettier config so `pnpm check` accepts it. */
export async function formatSharpReference(
  markdown: string,
  file: string,
): Promise<string> {
  const config = await resolveConfig(file)
  return format(markdown, { ...config, filepath: file })
}
