import { createServerFn } from '@tanstack/react-start'

import type { ExportFormat } from '@/features/export/export-settings'
import { PROTECTED_CHAIN } from '@/server/http/chains'
import { appFor } from '@/server/http/server-fn-context'

/** The export formats this machine can write, in the order the picker shows them. */
export const getExportFormats = createServerFn({ method: 'GET' })
  .middleware(PROTECTED_CHAIN)
  .handler(async ({ context }): Promise<Array<ExportFormat>> => {
    const { app } = await appFor(context)
    return app.renders.exportFormats()
  })
