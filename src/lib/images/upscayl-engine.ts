import OpenComicAI from 'opencomic-ai-bin'
import type { ModelObject, OpenComicAIUpscale } from 'opencomic-ai-bin'

import { UpscaleEngineError } from './errors.ts'
import { installModels } from './model-install.ts'
import { captureUncaughtErrors } from './uncaught.ts'
import type { AiPass, UpscaleEngine } from './upscale.ts'
import type { ModelChoice } from './upscale-options.ts'
import type { PinnedModel } from './upscale-models.ts'

/** One long-lived `upscayl-bin` process keeps the model loaded between images. */
const CONCURRENT_DAEMONS = 1
/** Relative-speed hint `opencomic-ai-bin` requires on custom models; unused for single images. */
const UNKNOWN_LATENCY = 1

export interface UpscaylEngine {
  upscale: UpscaleEngine
  /** Stops the background `upscayl-bin` process so Node can exit. */
  close: () => void
}

function registerUpscaylModel(modelsRoot: string, model: PinnedModel): void {
  const files: string[] = []
  for (const file of model.files) files.push(file.name)
  OpenComicAI.setCustomModel({
    key: model.name,
    name: model.description,
    upscaler: 'upscayl',
    type: 'custom',
    scales: model.scales,
    noise: undefined,
    latency: UNKNOWN_LATENCY,
    modelsPath: modelsRoot,
    folder: model.directory,
    files,
  } satisfies ModelObject)
}

function registerCustomModel(
  choice: Extract<ModelChoice, { kind: 'custom' }>,
  scale: number,
): void {
  OpenComicAI.setCustomModel({
    key: choice.name,
    name: choice.name,
    upscaler: 'upscayl',
    type: 'custom',
    scales: [scale],
    noise: undefined,
    latency: UNKNOWN_LATENCY,
    modelsPath: choice.directory,
    folder: '.',
    files: [`${choice.name}.param`, `${choice.name}.bin`],
  } satisfies ModelObject)
}

function modelKey(choice: ModelChoice): string {
  return choice.kind === 'pinned' ? choice.model.name : choice.name
}

function libraryOptions(pass: AiPass): OpenComicAIUpscale {
  return {
    model: modelKey(pass.model),
    scale: pass.scale,
    noise: pass.noise,
    tileSize: pass.tileSize === 0 ? 'auto' : pass.tileSize,
    maxTileSize: pass.maxTileSize,
    memorySafePercentage: pass.memorySafePercentage,
    gpuId: pass.gpuId,
    threads: pass.threads,
    tta: pass.tta,
    fp32: pass.fp32,
  }
}

/**
 * Creates an engine backed by the Vulkan `upscayl-bin` bundled with
 * `opencomic-ai-bin`. A catalogue model is verified (and downloaded if
 * missing) first, so the library never fetches an unverified file itself;
 * Upscayl's own models and custom models are registered with the library.
 */
export async function createUpscaylEngine(
  modelsRoot: string,
  choice: ModelChoice,
  scale: number,
): Promise<UpscaylEngine> {
  OpenComicAI.setModelsPath(modelsRoot)
  OpenComicAI.setConcurrentDaemons(CONCURRENT_DAEMONS)
  if (choice.kind === 'pinned') {
    await installModels(modelsRoot, [choice.model])
    if (choice.model.source === 'upscayl')
      registerUpscaylModel(modelsRoot, choice.model)
  } else {
    registerCustomModel(choice, scale)
  }

  const upscale: UpscaleEngine = async (pass) => {
    try {
      await captureUncaughtErrors(() =>
        OpenComicAI.image(pass.input, pass.output, libraryOptions(pass)),
      )
    } catch (error) {
      throw new UpscaleEngineError(pass.input, { cause: error })
    }
  }
  return { upscale, close: OpenComicAI.closeAllDaemons }
}
