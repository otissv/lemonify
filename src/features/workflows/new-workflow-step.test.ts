import { describe, expect, it } from 'vitest'

import type { AiCatalogues } from '@/features/ai/ai-defaults'
import { AiToolId } from '@/features/ai/ai-tools'
import { IMAGE_LAYER_KIND } from '@/features/pipeline/layer-kinds'
import { newWorkflowStep } from '@/features/workflows/new-workflow-step'
import { NO_CATALOGUE } from '@/features/tools/add-tool'

const CATALOGUES: AiCatalogues = [
  {
    tool: AiToolId.Upscale,
    catalogue: {
      defaultModel: 'siax',
      models: [
        {
          name: 'siax',
          category: 'upscale',
          description: 'NMKD Siax',
          scales: [2, 4],
          noise: null,
        },
      ],
    },
  },
]

describe('newWorkflowStep', () => {
  it('makes an empty image layer, a group and a Sharp step', () => {
    expect(newWorkflowStep({ kind: 'image-layer' }, [])).toMatchObject({
      step: { kind: IMAGE_LAYER_KIND, enabled: true },
    })
    expect(newWorkflowStep({ kind: 'group' }, [])).toMatchObject({
      step: { kind: 'group', steps: [] },
    })
    expect(newWorkflowStep({ kind: 'sharp', value: 'blur' }, [])).toMatchObject(
      { step: { kind: 'sharp', op: 'blur' } },
    )
  })

  it('starts a Sharp step with the values the website fills in', () => {
    expect(
      newWorkflowStep({ kind: 'sharp', value: 'scale' }, []),
    ).toMatchObject({ step: { op: 'scale', options: { percent: 100 } } })
  })

  it('makes an AI step with the settings its catalogue starts from', () => {
    expect(
      newWorkflowStep({ kind: 'ai', value: AiToolId.Upscale }, CATALOGUES),
    ).toMatchObject({
      step: { kind: 'ai', tool: AiToolId.Upscale, settings: { model: 'siax' } },
    })
  })

  it('says when the server does not offer the AI tool', () => {
    expect(
      newWorkflowStep({ kind: 'ai', value: AiToolId.Upscale }, []),
    ).toEqual({ problem: NO_CATALOGUE })
  })
})
