// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { cli, makeImage, setUpFlowFolders } from './flow-test-kit.ts'

setUpFlowFolders()

type Step = {
  id: string
  kind: string
  documentId?: string
  workflowId?: string
  sourceId?: string
}
type Doc = {
  document: { id: string; name: string; pipeline: { steps: Step[] } }
}
type Flow = { workflow: { id: string; name: string } }

async function source(name: string): Promise<string> {
  const file = await makeImage(name, { width: 32, height: 24 })
  const added = await cli<{ source: { id: string } }>('source', 'add', file)
  return added.source.id
}

describe('layers that use other documents and workflows, on the command line', () => {
  it('adds a document layer and a workflow layer with an image in its input slot', async () => {
    const photo = await source('photo.png')
    const badge = await cli<Doc>('document', 'create', photo, '--name', 'Badge')
    const poster = await cli<Doc>(
      'document',
      'create',
      photo,
      '--name',
      'Poster',
    )
    const { workflow } = await cli<Flow>(
      'workflow',
      'create',
      'Brand',
      '--steps',
      '[{"op":"flip"}]',
    )

    const withDocument = await cli<Doc>(
      'document',
      'step',
      'add',
      poster.document.id,
      '--document-layer',
      badge.document.id,
    )
    const withWorkflow = await cli<Doc>(
      'document',
      'step',
      'add',
      poster.document.id,
      '--workflow-layer',
      workflow.id,
      '--source',
      photo,
    )

    expect(withDocument.document.pipeline.steps.at(-1)).toMatchObject({
      kind: 'document-layer',
      documentId: badge.document.id,
    })
    expect(withWorkflow.document.pipeline.steps.at(-1)).toMatchObject({
      kind: 'workflow-layer',
      workflowId: workflow.id,
      sourceId: photo,
    })
  })

  it('refuses a layer that leads back to its own document, and to delete what a layer uses', async () => {
    const photo = await source('photo.png')
    const badge = await cli<Doc>('document', 'create', photo, '--name', 'Badge')
    const poster = await cli<Doc>(
      'document',
      'create',
      photo,
      '--name',
      'Poster',
    )
    await cli(
      'document',
      'step',
      'add',
      poster.document.id,
      '--document-layer',
      badge.document.id,
    )

    await expect(
      cli(
        'document',
        'step',
        'add',
        badge.document.id,
        '--document-layer',
        poster.document.id,
      ),
    ).rejects.toThrow(/cannot use the document or workflow that holds it/)
    await expect(cli('document', 'delete', badge.document.id)).rejects.toThrow(
      /the document "Poster"/,
    )
  })

  it('converts a document layer to an embedded document layer, which undo takes back', async () => {
    const photo = await source('photo.png')
    const badge = await cli<Doc>('document', 'create', photo, '--name', 'Badge')
    const poster = await cli<Doc>(
      'document',
      'create',
      photo,
      '--name',
      'Poster',
    )
    const added = await cli<Doc>(
      'document',
      'step',
      'add',
      poster.document.id,
      '--document-layer',
      badge.document.id,
    )
    const layer = added.document.pipeline.steps.at(-1)

    const converted = await cli<Doc>(
      'document',
      'step',
      'convert',
      poster.document.id,
      layer?.id ?? '',
      '--to',
      'embedded-document',
    )
    expect(converted.document.pipeline.steps.at(-1)).toMatchObject({
      id: layer?.id,
      kind: 'embedded-document',
      name: 'Badge',
    })

    const undone = await cli<Doc>('document', 'undo', poster.document.id)
    expect(undone.document.pipeline.steps.at(-1)).toMatchObject({
      kind: 'document-layer',
    })
    await expect(
      cli(
        'document',
        'step',
        'convert',
        poster.document.id,
        poster.document.pipeline.steps[0]?.id ?? '',
        '--to',
        'embedded-document',
      ),
    ).rejects.toThrow(/Only a document layer or a workflow layer/)
  })

  it('takes one kind of step at a time, and --source only with a layer that has an image', async () => {
    const photo = await source('photo.png')
    const poster = await cli<Doc>('document', 'create', photo)

    await expect(
      cli(
        'document',
        'step',
        'add',
        poster.document.id,
        '--document-layer',
        poster.document.id,
        '--op',
        'flip',
      ),
    ).rejects.toThrow(/Give one of/)
    await expect(
      cli(
        'document',
        'step',
        'add',
        poster.document.id,
        '--document-layer',
        'x',
        '--source',
        photo,
      ),
    ).rejects.toThrow(/--source goes with/)
  })
})
