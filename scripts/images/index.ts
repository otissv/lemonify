#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
/**
 * Single entry point for the image tools: Sharp pipelines (including width
 * variants and in-place compression), image inspection, and Upscayl AI
 * upscaling.
 *
 * Run with `pnpm images <command> [options]`; see `pnpm images --help`.
 */
import { JSON_FLAG, runCli } from './cli.ts'
import { COMMANDS } from './commands/index.ts'
import { dispatch, mainUsage } from './dispatch.ts'

const argv = process.argv.slice(2)

async function main(): Promise<void> {
  const selected = dispatch(COMMANDS, argv)
  if (selected.kind === 'help') {
    console.log(mainUsage(COMMANDS))
    return
  }
  await selected.command.execute(selected.argv, {
    json: selected.json,
    progress: selected.progress,
  })
}

await runCli(main, { json: argv.includes(JSON_FLAG) })
