// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { cli, makeImage, setUpFlowFolders } from './flow-test-kit.ts'

setUpFlowFolders()

type Step = { id: string; kind: string; sourceId?: string; op?: string }
type Doc = {
  document: {
    id: string
    name: string
    pipeline: {
      canvas: { width: number; height: number }
      steps: Step[]
    }
  }
}
type Flow = {
  workflow: {
    id: string
    name: string
    canvasSize: string
    inputs: string[]
    pipeline: { canvas: { width: number; height: number }; steps: Step[] }
  }
}

async function source(name: string, width = 64, height = 48): Promise<string> {
  const file = await makeImage(name, { width, height })
  const added = await cli<{ source: { id: string } }>('source', 'add', file)
  return added.source.id
}

describe('making a workflow from a document, and a document from a workflow, on the command line', () => {
  it('makes a workflow from a document, removing only the input image', async () => {
    const photo = await source('photo.png')
    const { document } = await cli<Doc>('document', 'create', photo)
    await cli('document', 'step', 'add', document.id, '--op', 'flip')

    const { workflow } = await cli<Flow>(
      'workflow',
      'create',
      '--from-document',
      document.id,
      '--images',
      'remove-input',
    )

    expect(workflow.name).toBe('photo')
    expect(workflow.canvasSize).toBe('fixed')
    expect(workflow.inputs).toEqual([photo])
    expect(workflow.pipeline.steps).toMatchObject([
      { kind: 'image-layer' },
      { kind: 'sharp', op: 'flip' },
    ])
    expect(workflow.pipeline.steps[0]).not.toHaveProperty('sourceId')
  })

  it('acts as the user --user names, like every command', async () => {
    const photo = await source('photo.png')
    const { document } = await cli<Doc>('document', 'create', photo)
    const { users } = await cli<{ users: { name: string }[] }>('user', 'list')
    const user = users[0]?.name
    if (user === undefined) throw new Error('No user was made.')

    const { workflow } = await cli<Flow>(
      'workflow',
      'create',
      '--from-document',
      document.id,
      '--images',
      'keep',
      '--user',
      user,
    )
    const made = await cli<Doc>(
      'document',
      'create',
      '--from-workflow',
      workflow.id,
      '--user',
      user,
    )

    expect(workflow.name).toBe('photo')
    expect(made.document.name).toBe('photo 2')
  })

  it('makes a workflow from a group, named as given', async () => {
    const photo = await source('photo.png')
    const { document } = await cli<Doc>('document', 'create', photo)
    const added = await cli<Doc>(
      'document',
      'step',
      'add',
      document.id,
      '--op',
      'flip',
    )
    const flip = added.document.pipeline.steps.at(-1)
    const grouped = await cli<Doc>(
      'document',
      'step',
      'group',
      document.id,
      flip?.id ?? '',
    )
    const group = grouped.document.pipeline.steps.at(-1)

    const { workflow } = await cli<Flow>(
      'workflow',
      'create',
      'Flipper',
      '--from-document',
      document.id,
      '--group',
      group?.id ?? '',
      '--images',
      'keep',
    )

    expect(workflow.name).toBe('Flipper')
    expect(workflow.pipeline.steps).toMatchObject([
      { kind: 'image-layer' },
      { kind: 'sharp', op: 'flip' },
    ])
  })

  it('refuses --from-document without --images, and with the flags that build a workflow', async () => {
    const photo = await source('photo.png')
    const { document } = await cli<Doc>('document', 'create', photo)

    await expect(
      cli('workflow', 'create', '--from-document', document.id),
    ).rejects.toThrow(/--images/)
    await expect(
      cli(
        'workflow',
        'create',
        '--from-document',
        document.id,
        '--images',
        'keep',
        '--steps',
        '[]',
      ),
    ).rejects.toThrow(/--from-document/)
    await expect(cli('workflow', 'create')).rejects.toThrow(/name/)
  })

  it('makes a document from a workflow, with the input image in its slot', async () => {
    const photo = await source('photo.png', 30, 20)
    const { workflow } = await cli<Flow>(
      'workflow',
      'create',
      'Shrink',
      '--sources',
      photo,
      '--steps',
      '[{"op":"flip"}]',
    )

    const { document } = await cli<Doc>(
      'document',
      'create',
      '--from-workflow',
      workflow.id,
    )

    expect(document.name).toBe('Shrink')
    expect(document.pipeline.canvas).toMatchObject({ width: 30, height: 20 })
    expect(document.pipeline.steps).toMatchObject([
      { kind: 'image-layer', sourceId: photo },
      { kind: 'sharp', op: 'flip' },
    ])
  })

  it('needs --width and --height for a workflow that matches each input and has none', async () => {
    const { workflow } = await cli<Flow>('workflow', 'create', 'Empty')

    await expect(
      cli('document', 'create', '--from-workflow', workflow.id),
    ).rejects.toThrow(/width and height/)
    const { document } = await cli<Doc>(
      'document',
      'create',
      '--from-workflow',
      workflow.id,
      '--width',
      '12',
      '--height',
      '9',
      '--name',
      'Blank one',
    )
    expect(document.name).toBe('Blank one')
    expect(document.pipeline.canvas).toMatchObject({ width: 12, height: 9 })
  })

  it('puts the source given with --from-workflow in the input slot, and refuses --background', async () => {
    const photo = await source('photo.png', 30, 20)
    const { workflow } = await cli<Flow>('workflow', 'create', 'Any')

    const { document } = await cli<Doc>(
      'document',
      'create',
      photo,
      '--from-workflow',
      workflow.id,
    )

    expect(document.pipeline.steps[0]).toMatchObject({
      kind: 'image-layer',
      sourceId: photo,
    })
    expect(document.pipeline.canvas).toMatchObject({ width: 30, height: 20 })
    await expect(
      cli(
        'document',
        'create',
        '--from-workflow',
        workflow.id,
        '--background',
        '#ffffff',
      ),
    ).rejects.toThrow(/--background/)
  })

  it('adds a workflow to a document as an embedded document layer, with an image in its input slot', async () => {
    const photo = await source('photo.png')
    const logo = await source('logo.png', 8, 8)
    const { document } = await cli<Doc>('document', 'create', photo)
    const { workflow } = await cli<Flow>(
      'workflow',
      'create',
      'Brand',
      '--steps',
      '[{"op":"flip"}]',
    )

    const added = await cli<Doc>(
      'document',
      'step',
      'add',
      document.id,
      '--workflow',
      workflow.id,
      '--source',
      logo,
    )

    expect(added.document.pipeline.steps.at(-1)).toMatchObject({
      kind: 'embedded-document',
      name: 'Brand',
      steps: [
        { kind: 'image-layer', sourceId: logo },
        { kind: 'sharp', op: 'flip' },
      ],
    })
    const undone = await cli<Doc>('document', 'undo', document.id)
    expect(undone.document.pipeline.steps).toHaveLength(1)
  })
})
