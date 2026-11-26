import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { StepNode } from '@/features/workflows/step-node'
import type { StepFlowNode } from '@/features/workflows/step-node'

const NODE_TYPES = { step: StepNode }

function showNode(data: StepFlowNode['data']): void {
  const node: StepFlowNode = {
    id: 'step-1',
    type: 'step',
    position: { x: 0, y: 0 },
    data,
  }
  render(
    <ReactFlowProvider>
      <div style={{ width: 400, height: 400 }}>
        <ReactFlow nodes={[node]} edges={[]} nodeTypes={NODE_TYPES} />
      </div>
    </ReactFlowProvider>,
  )
}

describe('StepNode', () => {
  it('deletes a pipeline step from the bin control', () => {
    const onDelete = vi.fn()
    showNode({
      label: 'Tint',
      summary: '1 option set',
      thumbnail: undefined,
      enabled: true,
      position: 'middle',
      deletable: true,
      onDelete,
    })

    fireEvent.click(screen.getByTitle('Delete Tint'))

    expect(onDelete).toHaveBeenCalledWith('step-1')
  })

  it('hides the bin on fixed nodes', () => {
    showNode({
      label: 'Canvas',
      summary: '1920 × 1080 px',
      thumbnail: undefined,
      enabled: true,
      position: 'start',
      deletable: false,
    })

    expect(
      screen.queryByRole('button', { name: /^Delete/ }),
    ).not.toBeInTheDocument()
  })
})
