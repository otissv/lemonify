import { describe, expect, it } from 'vitest'

import { AiToolId } from '@/features/ai/ai-tools'
import { createAiStep } from '@/features/pipeline/pipeline'
import {
  createImageLayerStep,
  layerImage,
} from '@/features/pipeline/layer-kinds'
import {
  createEmbeddedDocumentStep,
  createGroupStep,
  createSharpStep,
  leafSteps,
} from '@/features/pipeline/pipeline'
import type { PipelineStep } from '@/features/pipeline/pipeline'
import {
  CopyTarget,
  STEP_KINDS,
  copyStepsInto,
} from '@/features/pipeline/step-kinds'
import type { CopyContext } from '@/features/pipeline/step-kinds'

const UPSCALE = {
  tool: AiToolId.Upscale,
  settings: { model: 'm', scale: 4, iterations: 1, tta: false },
} as const

function keepImages(target: CopyTarget): CopyContext {
  return { target, layerImage }
}

function ids(steps: ReadonlyArray<PipelineStep>): string[] {
  return leafSteps({ steps }).map((step) => step.id)
}

describe('step kinds', () => {
  it('has a copy rule for every kind of step that is not a container, into both a document and a workflow', () => {
    for (const kind of [
      'sharp',
      'ai',
      'image-layer',
      'document-layer',
      'workflow-layer',
    ] as const) {
      expect(STEP_KINDS[kind].copy[CopyTarget.Document]).toBeTypeOf('function')
      expect(STEP_KINDS[kind].copy[CopyTarget.Workflow]).toBeTypeOf('function')
    }
  })

  it('copies every kind under new ids, keeping options, settings and switches', () => {
    const blur = { ...createSharpStep('blur', { sigma: 3 }), enabled: false }
    const ai = createAiStep(UPSCALE)
    const layer = { ...createImageLayerStep('src-1'), opacity: 40 }
    const source = [blur, ai, layer]

    const copied = copyStepsInto(source, keepImages(CopyTarget.Workflow))

    expect(copied).toHaveLength(3)
    for (const [index, step] of copied.entries()) {
      const { id: _from, ...was } = source[index] ?? blur
      const { id, ...now } = step
      expect(now).toEqual(was)
      expect(id).not.toBe(source[index]?.id)
    }
  })

  it('copies groups and embedded document layers at any depth, with placement kept', () => {
    const blur = createSharpStep('blur')
    const embedded = {
      ...createEmbeddedDocumentStep([createGroupStep([blur], 'Soft')], 'Badge'),
      opacity: 30,
    }

    const [copied] = copyStepsInto([embedded], keepImages(CopyTarget.Document))

    expect(copied).toMatchObject({
      kind: 'embedded-document',
      name: 'Badge',
      opacity: 30,
      steps: [{ kind: 'group', name: 'Soft', steps: [{ op: 'blur' }] }],
    })
    expect(ids(copied === undefined ? [] : [copied])).not.toContain(blur.id)
    expect(copied?.id).not.toBe(embedded.id)
  })

  it('asks the context which image each layer keeps, at any depth', () => {
    const top = createImageLayerStep('src-top')
    const deep = createImageLayerStep('src-deep')
    const context: CopyContext = {
      target: CopyTarget.Workflow,
      layerImage: (layer) =>
        layerImage(layer) === 'src-deep' ? undefined : layerImage(layer),
    }

    const copied = copyStepsInto(
      [top, createEmbeddedDocumentStep([createGroupStep([deep])])],
      context,
    )

    const layers = leafSteps({ steps: copied })
    expect(layers[0]).toMatchObject({ sourceId: 'src-top' })
    expect(layers[1]).not.toHaveProperty('sourceId')
  })
})
