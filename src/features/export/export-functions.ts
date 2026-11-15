import { createServerFn } from '@tanstack/react-start'

import type { ExportFormat } from '@/features/export/export-settings'
import { writableExportFormats } from '@/features/export/server/export-formats'
import { PROTECTED_CHAIN } from '@/server/http/chains'

/** The export formats this machine can write, in the order the picker shows them. */
export const getExportFormats = createServerFn({ method: 'GET' })
  .middleware(PROTECTED_CHAIN)
  .handler((): Promise<Array<ExportFormat>> => writableExportFormats())
