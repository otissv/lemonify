import path from 'node:path'
import { z } from 'zod'

/**
 * Upscale models the project pins. Each name maps to an `opencomic-ai-bin`
 * model key and the ncnn files it loads, with SHA-256 checksums so a
 * download is only accepted when it matches exactly.
 */
export const UPSCALE_MODEL_NAMES = ['siax', 'animevideov3'] as const
export const upscaleModelNameSchema = z.enum(UPSCALE_MODEL_NAMES, {
  error: `Model must be one of ${UPSCALE_MODEL_NAMES.join(', ')}`,
})
export type UpscaleModelName = z.infer<typeof upscaleModelNameSchema>

export const UPSCALE_SCALES = [2, 3, 4] as const
export const upscaleScaleSchema = z.literal(UPSCALE_SCALES, {
  error: 'Scale must be 2, 3 or 4',
})
export type UpscaleScale = z.infer<typeof upscaleScaleSchema>

export const DEFAULT_UPSCALE_MODEL = 'siax' satisfies UpscaleModelName
export const DEFAULT_UPSCALE_SCALE = 4 satisfies UpscaleScale

/** Project-relative folder that holds the downloaded model files. */
export const MODELS_ROOT = '.tools/upscayl-models'

/** Files are fetched from a fixed commit, so the content behind each URL never changes. */
export const MODEL_SOURCE_URL =
  'https://raw.githubusercontent.com/ollm/opencomic-ai-models/ca1c17faabcb029a14b8bcabfc864227d6b9e2b2/models/upscale/models/'

export interface ModelFile {
  name: string
  sha256: string
}

export interface UpscaleModel {
  /** Model key understood by `opencomic-ai-bin`. */
  key: string
  description: string
  files: readonly ModelFile[]
}

export const UPSCALE_MODELS: Readonly<Record<UpscaleModelName, UpscaleModel>> =
  {
    siax: {
      key: '4x_NMKD-Siax_200k',
      description: 'Photos and realistic images',
      files: [
        {
          name: '4x_NMKD-Siax_200k.bin',
          sha256:
            'b2abdffa30fb15be752ac681e0c0edf8b543745c33a989aadc9d7d3394dd3110',
        },
        {
          name: '4x_NMKD-Siax_200k.param',
          sha256:
            '519bffb4912e295155d3cb5d6a29639d217ccca55f80962d8f677ef777a65b7a',
        },
      ],
    },
    animevideov3: {
      key: 'realesr-animevideov3',
      description: 'Anime, illustrations and flat-colour art',
      files: [
        {
          name: 'realesr-animevideov3-x2.bin',
          sha256:
            '548a36f9c3f4ab8da56cd3b13badf23968bee207b396dad14d04b830e5f2ab2d',
        },
        {
          name: 'realesr-animevideov3-x2.param',
          sha256:
            'b88ff4f00ebf019a7fdac17fdd45a7fd3665d37509efc5baf2e4da2e24420a04',
        },
        {
          name: 'realesr-animevideov3-x3.bin',
          sha256:
            '548a36f9c3f4ab8da56cd3b13badf23968bee207b396dad14d04b830e5f2ab2d',
        },
        {
          name: 'realesr-animevideov3-x3.param',
          sha256:
            'd1a5755008791d09b57e3425fc9dd0bd26b00fdf79c606210bc0e693f8230881',
        },
        {
          name: 'realesr-animevideov3-x4.bin',
          sha256:
            '548a36f9c3f4ab8da56cd3b13badf23968bee207b396dad14d04b830e5f2ab2d',
        },
        {
          name: 'realesr-animevideov3-x4.param',
          sha256:
            '850a248e7c14c27e5bd8cf7265113a9441036a7db63963bb8aa5169d788a435e',
        },
      ],
    },
  }

/** `opencomic-ai-bin` reads upscale models from `<modelsPath>/upscale/models/`. */
export function modelFilesDirectory(modelsRoot: string): string {
  return path.join(modelsRoot, 'upscale', 'models')
}
