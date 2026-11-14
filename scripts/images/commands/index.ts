import type { ImageCommand } from '../cli.ts'
import { formatsCommand } from './formats.ts'
import { infoCommand } from './info.ts'
import { modelsCommand } from './models.ts'
import { schemaCommand } from './schema.ts'
import { sharpCommand } from './sharp.ts'
import { upscaleCommand } from './upscale.ts'

/** Every `pnpm images` subcommand, in the order the help lists them. */
export const COMMANDS: readonly ImageCommand[] = [
  sharpCommand,
  infoCommand,
  upscaleCommand,
  modelsCommand,
  formatsCommand,
  schemaCommand,
]
