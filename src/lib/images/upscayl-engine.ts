import OpenComicAI from 'opencomic-ai-bin'

import { UpscaleEngineError } from './errors.ts'
import { installUpscaleModels } from './model-install.ts'
import { captureUncaughtErrors } from './uncaught.ts'
import type { UpscaleEngine } from './upscale.ts'
import { UPSCALE_MODELS } from './upscale-models.ts'
import type { UpscaleModelName } from './upscale-models.ts'

/** One long-lived `upscayl-bin` process keeps the model loaded between images. */
const CONCURRENT_DAEMONS = 1

export interface UpscaylEngine {
  upscale: UpscaleEngine
  /** Stops the background `upscayl-bin` process so Node can exit. */
  close: () => void
}

/**
 * Creates an engine backed by the Vulkan `upscayl-bin` bundled with
 * `opencomic-ai-bin`. The models are verified (and downloaded if missing)
 * first, so the library never fetches an unverified file itself.
 */
export async function createUpscaylEngine(
  modelsRoot: string,
  models: readonly UpscaleModelName[],
): Promise<UpscaylEngine> {
  await installUpscaleModels(modelsRoot, models)
  OpenComicAI.setModelsPath(modelsRoot)
  OpenComicAI.setConcurrentDaemons(CONCURRENT_DAEMONS)

  const upscale: UpscaleEngine = async (job) => {
    try {
      await captureUncaughtErrors(() =>
        OpenComicAI.image(job.source, job.output, {
          model: UPSCALE_MODELS[job.model].key,
          scale: job.scale,
        }),
      )
    } catch (error) {
      throw new UpscaleEngineError(job.source, { cause: error })
    }
  }
  return { upscale, close: OpenComicAI.closeAllDaemons }
}
