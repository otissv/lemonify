import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ItemNamesContext } from '@/features/documents/item-names'
import {
  createDocumentLayerStep,
  createWorkflowLayerStep,
} from '@/features/pipeline/layer-kinds'
import type { LayerStep } from '@/features/pipeline/layer-kinds'
import { convertLayer } from '@/features/create-from/convert-layer'
import { WorkflowLayerOptions } from '@/features/workflows/workflow-layer-options'

const navigate = vi.fn()

vi.mock('@/features/create-from/convert-layer', () => ({
  convertLayer: vi.fn(),
}))

vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}))

const ITEMS = {
  documents: [{ id: 'd2', name: 'Badge' }],
  workflows: [{ id: 'w2', name: 'Brand' }],
}

function show(step: LayerStep, onChange = vi.fn()): typeof onChange {
  render(
    <ItemNamesContext value={ITEMS}>
      <WorkflowLayerOptions
        workflowId="w9"
        step={step}
        imageName={(id) => (id === 's1' ? 'logo.png' : id)}
        isInputSlot={false}
        onChange={onChange}
      />
    </ItemNamesContext>,
  )
  return onChange
}

afterEach(() => {
  vi.resetAllMocks()
})

describe('a document layer in a workflow', () => {
  it('names the document, opens it, and offers the settings every layer has', async () => {
    const user = userEvent.setup()
    show(createDocumentLayerStep('d2'))

    expect(screen.getByText('Badge')).toBeVisible()
    expect(screen.getByRole('slider', { name: 'Opacity' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Open Badge' }))

    expect(navigate).toHaveBeenCalledWith({
      to: '/documents/$id',
      params: { id: 'd2' },
    })
  })
})

describe('a workflow layer in a workflow', () => {
  it('names the workflow and its image, and takes the image out', async () => {
    const user = userEvent.setup()
    const step = createWorkflowLayerStep('w2', 's1')
    const onChange = show(step)

    expect(screen.getByText('Brand')).toBeVisible()
    expect(screen.getByText(/logo\.png/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Remove the image' }))

    expect(onChange).toHaveBeenCalledWith({
      type: 'set-image',
      stepId: step.id,
      sourceId: null,
    })
  })

  it('says when the workflow is gone', () => {
    show(createWorkflowLayerStep('gone'))

    expect(screen.getByText('Workflow not available')).toBeVisible()
    expect(screen.queryByRole('button', { name: /^Open/ })).toBeNull()
  })
})

describe('converting a layer in a workflow', () => {
  it('converts the layer in this workflow', async () => {
    const user = userEvent.setup()
    const step = createDocumentLayerStep('d2')
    show(step)

    await user.click(
      screen.getByRole('button', {
        name: 'Convert to embedded document layer',
      }),
    )

    expect(convertLayer).toHaveBeenCalledWith('w9', step.id)
  })
})
