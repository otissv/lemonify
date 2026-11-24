import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AiToolId, AI_TOOLS } from '@/features/ai/ai-tools'
import { getExportFormats } from '@/features/export/export-functions'
import { ExportFormat } from '@/features/export/export-settings'
import { listResults } from '@/features/results/result-functions'
import { listSources } from '@/features/sources/source-functions'
import type { UpscaleCatalogue } from '@/features/upscale/upscale-settings'
import type { AiToolEntry } from '@/features/workflows/ai-tool-entries'
import type { OutputSettings } from '@/features/workflows/output-settings'
import { INITIAL_LIBRARY_STATE, useLibraryStore } from '@/store/library-store'
import {
  RunCanvasMode,
  WorkflowSchema,
  createWorkflow,
} from '@/features/workflows/workflow'
import type {
  Workflow,
  WorkflowDefinition,
} from '@/features/workflows/workflow'
import {
  cancelWorkflowRun,
  deleteWorkflowRun,
  getWorkflow,
  listWorkflowRuns,
  changeWorkflow,
  redoWorkflow,
  runWorkflow,
  undoWorkflow,
} from '@/features/workflows/workflow-functions'
import { IMAGE_LAYER_KIND } from '@/features/pipeline/layer-kinds'
import { WorkflowPage } from '@/features/workflows/workflow-page'

import {
  WorkflowChangeSchema,
  applyWorkflowChange,
  planWorkflowChange,
} from '@/features/workflows/workflow-change'
import type {
  WorkflowChange,
  WorkflowHistoryPatch,
} from '@/features/workflows/workflow-change'
import { RunState } from '@/server/dao/workflow-dao'
import type { RunView, WorkflowView } from '@/server/services/workflow-service'
import { resetStores } from '@/store/reset-stores'

vi.mock('@/features/app/app-menu-bar', () => ({
  AppMenuBar: () => <div role="menubar" aria-label="Application" />,
}))

vi.mock('@/features/keybindings/key-bindings', () => ({
  KeyBindings: () => null,
}))

vi.mock('@/features/workflows/workflow-functions', () => ({
  getWorkflow: vi.fn(),
  changeWorkflow: vi.fn(),
  undoWorkflow: vi.fn(),
  redoWorkflow: vi.fn(),
  listWorkflowRuns: vi.fn(),
  runWorkflow: vi.fn(),
  cancelWorkflowRun: vi.fn(),
  deleteWorkflowRun: vi.fn(),
}))

vi.mock('@/features/sources/source-functions', () => ({
  listSources: vi.fn(),
}))

vi.mock('@/features/results/result-functions', () => ({
  listResults: vi.fn(),
}))

vi.mock('@/features/export/export-functions', () => ({
  getExportFormats: vi.fn(),
}))

const PHOTO_A = {
  id: 'src-a',
  fileName: 'a.jpg',
  mediaType: 'image/jpeg',
  bytes: 2048,
  width: 10,
  height: 10,
}
const PHOTO_B = { ...PHOTO_A, id: 'src-b', fileName: 'b.png', bytes: 4096 }

const CATALOGUE: UpscaleCatalogue = {
  defaultModel: 'siax',
  models: [
    {
      name: 'siax',
      category: 'upscale',
      description: 'NMKD Siax',
      scales: [2, 3, 4],
      noise: null,
    },
  ],
}

const AI_TOOL_ENTRIES: ReadonlyArray<AiToolEntry> = [
  { tool: AI_TOOLS[AiToolId.Upscale], catalogue: CATALOGUE },
]

const NOW = '2026-01-01T00:00:00.000Z'

/** What the server holds of the workflow the page edits: its definition, its revision and its Edit history, so the page is tested against the real changes. */
const server: {
  workflow: Workflow
  revision: number
  entries: WorkflowHistoryPatch[]
  cursor: number
} = { workflow: createWorkflow('Unset'), revision: 0, entries: [], cursor: 0 }

function serverDefinition(): WorkflowDefinition {
  const { pipeline, inputs, output } = server.workflow
  return { pipeline, inputs, output }
}

function serverView(): WorkflowView {
  return {
    ...server.workflow,
    revision: server.revision,
    canUndo: server.cursor > 0,
    canRedo: server.cursor < server.entries.length,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function seedServer(workflow: Workflow): void {
  server.workflow = workflow
  server.revision = 0
  server.entries = []
  server.cursor = 0
}

function setServerDefinition(change: WorkflowChange) {
  const { id, name } = server.workflow
  server.workflow = WorkflowSchema.parse({
    id,
    name,
    ...applyWorkflowChange(serverDefinition(), change),
  })
}

function installServer(): void {
  vi.mocked(getWorkflow).mockImplementation(async () => serverView())
  vi.mocked(changeWorkflow).mockImplementation(async ({ data }) => {
    const planned = planWorkflowChange(
      serverDefinition(),
      WorkflowChangeSchema.parse(data.change),
    )
    if (planned !== null) {
      const { id, name } = server.workflow
      server.workflow = WorkflowSchema.parse({
        id,
        name,
        ...planned.definition,
      })
      server.entries = [
        ...server.entries.slice(0, server.cursor),
        planned.patch,
      ]
      server.cursor += 1
      server.revision += 1
    }
    return serverView()
  })
  vi.mocked(undoWorkflow).mockImplementation(async () => {
    const entry = server.entries[server.cursor - 1]
    if (entry === undefined) throw new Error('There is nothing to undo.')
    setServerDefinition(entry.inverse)
    server.cursor -= 1
    server.revision += 1
    return serverView()
  })
  vi.mocked(redoWorkflow).mockImplementation(async () => {
    const entry = server.entries[server.cursor]
    if (entry === undefined) throw new Error('There is nothing to redo.')
    setServerDefinition(entry.forward)
    server.cursor += 1
    server.revision += 1
    return serverView()
  })
}

function run(overrides: Partial<RunView>): RunView {
  return {
    id: 'run-1',
    workflowId: 'wf',
    canvasMode: RunCanvasMode.Workflow,
    state: RunState.Done,
    createdAt: NOW,
    finishedAt: NOW,
    jobs: {
      total: 2,
      waiting: 0,
      running: 0,
      done: 2,
      failed: 0,
      cancelled: 0,
    },
    progress: 1,
    errors: [],
    ...overrides,
  }
}

/** The workflow as the server holds it now. */
function savedWorkflow(): Workflow {
  return server.workflow
}

async function renderPage(workflow: Workflow): Promise<void> {
  seedServer(workflow)
  render(<WorkflowPage id={workflow.id} aiTools={AI_TOOL_ENTRIES} />)
  await screen.findByRole('dialog', { name: 'Tools' })
}

function canvas(): HTMLElement {
  return screen.getByRole('application', { name: 'Workflow canvas' })
}

/** Selects a node of the diagram: a step by its name, or Canvas, Input images or Output. The panel then shows its options. */
async function clickStep(name: string): Promise<void> {
  const node = await within(canvas()).findByText(name)
  fireEvent.click(node)
  await waitFor(() => {
    expect(screen.getByRole('tab', { name: 'Options' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })
}

function openTab(name: string): HTMLElement {
  fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0 })
  return screen.getByRole('tabpanel', { name })
}

/** The Tools tab, which adds steps. */
function palette(): HTMLElement {
  const panel = openTab('Tools')
  for (const group of panel.querySelectorAll('button[aria-expanded="false"]')) {
    fireEvent.click(group)
  }
  return panel
}

/** The Options tab, which shows what is selected. */
function inspector(): HTMLElement {
  return screen.getByRole('tabpanel', { name: 'Options' })
}

/** The Run tab, which starts the workflow and lists its runs. */
function runTab(): HTMLElement {
  return openTab('Run')
}

/** The kind of each step in the last save, with a Sharp step shown by its op. */
function stepKinds(): string[] {
  return savedWorkflow().pipeline.steps.map((step) =>
    step.kind === 'sharp' ? step.op : step.kind,
  )
}

describe('WorkflowPage', () => {
  beforeEach(() => {
    resetStores()
    useLibraryStore.setState(INITIAL_LIBRARY_STATE)
    vi.mocked(getExportFormats).mockResolvedValue([
      ExportFormat.Original,
      ExportFormat.Jpeg,
      ExportFormat.Png,
      ExportFormat.Webp,
    ])
    vi.mocked(listSources).mockResolvedValue([PHOTO_A, PHOTO_B])
    vi.mocked(listWorkflowRuns).mockResolvedValue([])
    vi.mocked(listResults).mockResolvedValue([])
    installServer()
  })

  it('names the workflow', async () => {
    await renderPage(createWorkflow('Sharpen photos'))

    expect(
      within(runTab()).getByRole('heading', { name: 'Sharpen photos' }),
    ).toBeInTheDocument()
  })

  it('says why the workflow could not be loaded', async () => {
    vi.mocked(getWorkflow).mockRejectedValue(
      new Error('That workflow does not exist.'),
    )
    render(<WorkflowPage id="missing" aiTools={AI_TOOL_ENTRIES} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That workflow does not exist.',
    )
  })

  it('shows the canvas, the input images, the input layer and the output as a diagram', async () => {
    await renderPage(createWorkflow('Test'))
    const diagram = within(canvas())

    for (const [label, summary] of [
      ['Canvas', '1920 × 1080 px · transparent'],
      ['Input images', 'No images yet'],
      ['Image layer', 'Each input image goes here'],
      ['Output', 'Same as original'],
    ]) {
      expect(await diagram.findByText(label ?? '')).toBeInTheDocument()
      expect(diagram.getByText(summary ?? '')).toBeInTheDocument()
    }
  })

  it('has the floating panel only: no tool column, step list or options column', async () => {
    await renderPage(createWorkflow('Test'))

    expect(
      screen.queryByRole('region', { name: 'Steps' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: 'Workflow steps' }),
    ).not.toBeInTheDocument()
  })

  it('offers the workflow tabs only: Tools, Options and Run', async () => {
    await renderPage(createWorkflow('Test'))

    expect(
      screen.getAllByRole('tab').map((tab) => tab.getAttribute('aria-label')),
    ).toEqual(['Tools', 'Options', 'Run'])
  })

  describe('output', () => {
    async function selectOutput(): Promise<HTMLElement> {
      await clickStep('Output')
      return inspector()
    }

    function outputSettings(_id: string): OutputSettings {
      return savedWorkflow().output
    }

    async function chooseOption(
      panel: HTMLElement,
      control: string,
      option: string,
    ): Promise<void> {
      const user = userEvent.setup()
      await user.click(
        await within(panel).findByRole('combobox', { name: control }),
      )
      await user.click(await screen.findByRole('option', { name: option }))
    }

    it('starts with the original format and size, and no folder to choose', async () => {
      await renderPage(createWorkflow('Test'))

      const panel = await selectOutput()

      expect(panel).not.toHaveTextContent('Folder')
      expect(panel).not.toHaveTextContent('already exists')
      expect(
        await within(panel).findByRole('combobox', { name: 'Format' }),
      ).toHaveTextContent('Same as original')
      expect(
        await within(panel).findByRole('combobox', { name: 'Size' }),
      ).toHaveTextContent('Keep size')
    })

    it('shows only the fields of the chosen format', async () => {
      const workflow = createWorkflow('Test')
      await renderPage(workflow)
      const panel = await selectOutput()

      await chooseOption(panel, 'Format', 'JPEG')
      expect(
        within(panel).getByRole('slider', { name: 'Quality' }),
      ).toBeInTheDocument()

      await chooseOption(panel, 'Format', 'PNG')
      expect(
        within(panel).queryByRole('slider', { name: 'Quality' }),
      ).not.toBeInTheDocument()
      expect(
        within(panel).getByRole('slider', { name: 'Compression' }),
      ).toBeInTheDocument()
      await waitFor(() => {
        expect(outputSettings(workflow.id).format).toBe(ExportFormat.Png)
      })
    })

    describe('sizes', () => {
      async function chooseWidths(panel: HTMLElement): Promise<void> {
        await chooseOption(panel, 'Size', 'Responsive widths')
      }

      it('offers a suffix while keeping the size, and none for widths', async () => {
        const user = userEvent.setup()
        await renderPage(createWorkflow('Test'))
        const panel = await selectOutput()

        await user.type(
          within(panel).getByRole('textbox', { name: 'Suffix' }),
          '-web',
        )
        await chooseWidths(panel)

        expect(
          within(panel).queryByRole('textbox', { name: 'Suffix' }),
        ).not.toBeInTheDocument()
      })

      it('adds widths one at a time, smallest first, once each', async () => {
        const workflow = createWorkflow('Test')
        const user = userEvent.setup()
        await renderPage(workflow)
        const panel = await selectOutput()
        await chooseWidths(panel)
        const width = within(panel).getByRole('spinbutton', {
          name: 'New width',
        })

        await user.type(width, '768')
        await user.click(
          within(panel).getByRole('button', { name: 'Add width' }),
        )
        await user.type(width, '480')
        await user.click(
          within(panel).getByRole('button', { name: 'Add width' }),
        )
        await user.type(width, '768')
        await user.click(
          within(panel).getByRole('button', { name: 'Add width' }),
        )

        await waitFor(() => {
          expect(outputSettings(workflow.id).widths).toEqual([480, 768])
        })
      })

      it('adds the common responsive sizes in one click', async () => {
        const workflow = createWorkflow('Test')
        const user = userEvent.setup()
        await renderPage(workflow)
        const panel = await selectOutput()
        await chooseWidths(panel)

        await user.click(
          await within(panel).findByRole('button', {
            name: 'Add common sizes',
          }),
        )

        await waitFor(() => {
          expect(outputSettings(workflow.id).widths).toEqual([
            480, 768, 1024, 1440,
          ])
        })
      })

      it('removes a width', async () => {
        const workflow = createWorkflow('Test')
        const user = userEvent.setup()
        await renderPage(workflow)
        const panel = await selectOutput()
        await chooseWidths(panel)
        await user.click(
          await within(panel).findByRole('button', {
            name: 'Add common sizes',
          }),
        )

        await user.click(
          within(panel).getByRole('button', { name: 'Remove 768' }),
        )

        await waitFor(() => {
          expect(outputSettings(workflow.id).widths).toEqual([480, 1024, 1440])
        })
      })

      it('previews the file names made from each image', async () => {
        const user = userEvent.setup()
        await renderPage(createWorkflow('Test'))
        const panel = await selectOutput()
        await chooseWidths(panel)
        await chooseOption(panel, 'Format', 'WebP')
        await user.click(
          await within(panel).findByRole('button', {
            name: 'Add common sizes',
          }),
        )

        const preview = await within(panel).findByRole('list', {
          name: 'Files per image',
        })

        await waitFor(() => {
          expect(
            within(preview)
              .getAllByRole('listitem')
              .map((item) => item.textContent),
          ).toEqual([
            'photo-480.webp',
            'photo-768.webp',
            'photo-1024.webp',
            'photo-1440.webp',
          ])
        })
      })

      it('goes back to keeping the size without losing the format', async () => {
        const workflow = createWorkflow('Test')
        const user = userEvent.setup()
        await renderPage(workflow)
        const panel = await selectOutput()
        await chooseOption(panel, 'Format', 'JPEG')
        await chooseWidths(panel)
        await user.click(
          await within(panel).findByRole('button', {
            name: 'Add common sizes',
          }),
        )

        await chooseOption(panel, 'Size', 'Keep size')

        await waitFor(() => {
          expect(outputSettings(workflow.id)).toMatchObject({
            widths: [],
            format: ExportFormat.Jpeg,
          })
        })
      })
    })
  })

  describe('input images', () => {
    async function selectInput(): Promise<HTMLElement> {
      await clickStep('Input images')
      return inspector()
    }

    function inputSourceIds(): ReadonlyArray<string> {
      return savedWorkflow().inputs
    }

    it('says there are no images yet and offers to upload some', async () => {
      await renderPage(createWorkflow('Test'))

      const panel = await selectInput()

      expect(panel).toHaveTextContent('No images yet')
      expect(
        within(panel).getByRole('button', { name: 'Upload images…' }),
      ).toBeInTheDocument()
    })

    it('adds one of your images and shows the count on the canvas', async () => {
      const user = userEvent.setup()
      await renderPage(createWorkflow('Test'))
      const panel = await selectInput()

      await user.click(
        await within(panel).findByRole('button', { name: 'Add a.jpg' }),
      )

      const list = within(panel).getByRole('list', { name: 'Images' })
      expect(within(list).getByText('a.jpg')).toBeInTheDocument()
      await waitFor(() => {
        expect(inputSourceIds()).toEqual(['src-a'])
      })
      expect(within(canvas()).getByText('1 image')).toBeInTheDocument()
    })

    it('adds an uploaded image', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          Response.json({ data: [PHOTO_B], error: '' }, { status: 201 }),
        ),
      )
      await renderPage(createWorkflow('Test'))
      const panel = await selectInput()

      fireEvent.change(within(panel).getByLabelText('Upload images… file'), {
        target: {
          files: [new File(['x'], 'b.png', { type: 'image/png' })],
        },
      })

      await waitFor(() => {
        expect(inputSourceIds()).toEqual(['src-b'])
      })
      vi.unstubAllGlobals()
    })

    it('removes an image', async () => {
      const user = userEvent.setup()
      await renderPage(createWorkflow('Test'))
      const panel = await selectInput()
      await user.click(
        await within(panel).findByRole('button', { name: 'Add a.jpg' }),
      )
      await user.click(
        await within(panel).findByRole('button', { name: 'Add b.png' }),
      )

      await user.click(
        within(panel).getByRole('button', { name: 'Remove a.jpg' }),
      )

      await waitFor(() => {
        expect(inputSourceIds()).toEqual(['src-b'])
      })
    })
  })

  describe('palette', () => {
    it('inserts a new step after the selected step', async () => {
      const workflow = createWorkflow('Test')
      const user = userEvent.setup()
      await renderPage(workflow)

      await user.click(
        within(palette()).getByRole('button', { name: 'Add Resize' }),
      )
      await user.click(
        within(palette()).getByRole('button', { name: 'Add Rotate' }),
      )
      await clickStep('Image layer')
      await user.click(
        within(palette()).getByRole('button', { name: 'Add Sharpen' }),
      )

      await waitFor(() => {
        expect(stepKinds()).toEqual([
          IMAGE_LAYER_KIND,
          'sharpen',
          'resize',
          'rotate',
        ])
      })
    })

    it('has no placement hint above the steps', async () => {
      const user = userEvent.setup()
      await renderPage(createWorkflow('Test'))
      await user.click(
        within(palette()).getByRole('button', { name: 'Add Resize' }),
      )

      expect(palette()).not.toHaveTextContent(/Adds (after|to the end)/)
    })

    it('offers layers, AI upscale and the tools a document offers, and no Composite', async () => {
      await renderPage(createWorkflow('Test'))

      for (const group of ['Layers', 'AI', 'Geometry', 'Filters', 'Colour']) {
        expect(
          within(palette()).getByRole('heading', { name: group }),
        ).toBeInTheDocument()
      }
      expect(
        within(palette()).getByRole('button', { name: 'Add Upscale' }),
      ).toBeInTheDocument()
      expect(
        within(palette()).getByRole('button', { name: 'Add Resize' }),
      ).toBeInTheDocument()
      expect(
        within(palette()).queryByRole('heading', { name: 'Output' }),
      ).not.toBeInTheDocument()
      expect(
        within(palette()).queryByRole('button', { name: 'Add Composite' }),
      ).not.toBeInTheDocument()
    })

    it('adds a step to the end of the pipeline and selects it', async () => {
      const workflow = createWorkflow('Test')
      const user = userEvent.setup()
      await renderPage(workflow)

      await user.click(
        within(palette()).getByRole('button', { name: 'Add Resize' }),
      )

      await waitFor(() => {
        expect(stepKinds()).toEqual([IMAGE_LAYER_KIND, 'resize'])
      })
      expect(
        within(inspector()).getByRole('heading', { name: 'Resize' }),
      ).toBeInTheDocument()
    })
  })

  describe('step options', () => {
    async function addResize(): Promise<Workflow> {
      const workflow = createWorkflow('Test')
      const user = userEvent.setup()
      await renderPage(workflow)
      await user.click(
        within(palette()).getByRole('button', { name: 'Add Resize' }),
      )
      return workflow
    }

    function resizeOptions(_id: string): unknown {
      const step = savedWorkflow().pipeline.steps.find(
        ({ kind }) => kind === 'sharp',
      )
      return step?.kind === 'sharp' ? step.options : undefined
    }

    it('asks for something to be selected at first', async () => {
      await renderPage(createWorkflow('Test'))

      expect(screen.getByRole('tab', { name: 'Options' })).toBeDisabled()
    })

    it('saves a number option to the step', async () => {
      const workflow = await addResize()
      const user = userEvent.setup()

      await user.type(
        within(inspector()).getByRole('spinbutton', { name: 'Width' }),
        '800',
      )

      await waitFor(() => {
        expect(resizeOptions(workflow.id)).toEqual({ width: 800 })
      })
    })

    it('resets a step to how a new one starts', async () => {
      const workflow = await addResize()
      const user = userEvent.setup()
      const reset = within(inspector()).getByRole('button', {
        name: 'Reset to defaults',
      })
      expect(reset).toBeDisabled()

      await user.type(
        within(inspector()).getByRole('spinbutton', { name: 'Width' }),
        '800',
      )
      await waitFor(() => {
        expect(resizeOptions(workflow.id)).toEqual({ width: 800 })
      })
      await user.click(reset)

      await waitFor(() => {
        expect(resizeOptions(workflow.id)).toEqual({})
      })
    })

    it('clears an option when its field is emptied', async () => {
      const workflow = await addResize()
      const user = userEvent.setup()
      const width = within(inspector()).getByRole('spinbutton', {
        name: 'Width',
      })

      await user.type(width, '8')
      await user.clear(width)

      await waitFor(() => {
        expect(resizeOptions(workflow.id)).toEqual({})
      })
    })

    it('saves a choice option', async () => {
      const workflow = await addResize()
      const user = userEvent.setup()

      await user.click(
        within(inspector()).getByRole('combobox', { name: 'Fit' }),
      )
      await user.click(screen.getByRole('option', { name: 'cover' }))

      await waitFor(() => {
        expect(resizeOptions(workflow.id)).toEqual({ fit: 'cover' })
      })
    })

    it('shows the image CLI’s problem with an option on its field', async () => {
      await addResize()
      const user = userEvent.setup()
      const width = within(inspector()).getByRole('spinbutton', {
        name: 'Width',
      })

      await user.type(width, '0')

      expect(width).toHaveAttribute('aria-invalid', 'true')
      expect(width).toHaveAccessibleDescription(/too small|>0|greater/i)
    })

    it('marks required options without calling them invalid', async () => {
      const user = userEvent.setup()
      await renderPage(createWorkflow('Test'))

      await user.click(
        within(palette()).getByRole('button', { name: 'Add Extract' }),
      )

      const left = within(inspector()).getByRole('spinbutton', {
        name: 'Left',
      })
      expect(left).not.toHaveAttribute('aria-invalid')
      expect(left).toBeRequired()
      expect(left).toHaveAccessibleDescription(/required/i)
      expect(screen.getByText('Needs 4 options')).toBeInTheDocument()
    })

    it('edits upscale settings for an Upscale step', async () => {
      const workflow = createWorkflow('Test')
      const user = userEvent.setup()
      await renderPage(workflow)

      await user.click(
        within(palette()).getByRole('button', { name: 'Add Upscale' }),
      )
      await user.click(
        within(inspector()).getByRole('combobox', { name: 'Scale' }),
      )
      await user.click(screen.getByRole('option', { name: '2×' }))

      await waitFor(() => {
        const step = savedWorkflow().pipeline.steps.find(
          ({ kind }) => kind === 'ai',
        )
        expect(step?.kind === 'ai' && step.settings).toMatchObject({
          model: 'siax',
          scale: 2,
        })
      })
    })

    it('removes the selected step', async () => {
      await addResize()
      const user = userEvent.setup()

      await user.click(
        within(inspector()).getByRole('button', { name: 'Remove step' }),
      )

      await waitFor(() => {
        expect(savedWorkflow().pipeline.steps).toHaveLength(1)
      })
      expect(screen.getByRole('tab', { name: 'Options' })).toBeDisabled()
    })

    it('removes a step from the diagram', async () => {
      const user = userEvent.setup()
      await renderPage(createWorkflow('Test'))
      await user.click(
        within(palette()).getByRole('button', { name: 'Add Resize' }),
      )

      await waitFor(() => {
        expect(stepKinds()).toEqual([IMAGE_LAYER_KIND, 'resize'])
      })

      await user.click(screen.getByTitle('Delete Resize'))

      await waitFor(() => {
        expect(savedWorkflow().pipeline.steps).toHaveLength(1)
      })
      expect(screen.getByRole('tab', { name: 'Options' })).toBeDisabled()
    })
  })

  describe('layers and groups', () => {
    it('adds an empty image layer, the place an input image goes, and selects it', async () => {
      const user = userEvent.setup()
      await renderPage(createWorkflow('Test'))

      await user.click(
        within(palette()).getByRole('button', { name: 'Add Image layer' }),
      )

      await waitFor(() => {
        expect(stepKinds()).toEqual([IMAGE_LAYER_KIND, IMAGE_LAYER_KIND])
      })
      expect(inspector()).toHaveTextContent('Each input image goes here')
      expect(
        within(inspector()).getByRole('button', { name: 'Use a fixed image…' }),
      ).toBeInTheDocument()
    })

    it('gives a layer a fixed image, and goes back to the input image', async () => {
      const user = userEvent.setup()
      await renderPage(createWorkflow('Test'))
      await clickStep('Image layer')

      await user.click(
        await within(inspector()).findByRole('button', {
          name: 'Choose an image for image',
        }),
      )
      await user.click(await screen.findByRole('menuitem', { name: 'a.jpg' }))

      await waitFor(() => {
        const [layer] = savedWorkflow().pipeline.steps
        expect(layer).toMatchObject({ sourceId: 'src-a' })
      })
      expect(inspector()).toHaveTextContent('always draws a.jpg')

      await user.click(
        within(inspector()).getByRole('button', {
          name: 'Use the input image',
        }),
      )

      await waitFor(() => {
        expect(savedWorkflow().pipeline.steps[0]).not.toHaveProperty('sourceId')
      })
    })

    it('saves the placement of a layer', async () => {
      const user = userEvent.setup()
      await renderPage(createWorkflow('Test'))
      await clickStep('Image layer')

      await user.click(
        within(inspector()).getByRole('combobox', { name: 'Blend mode' }),
      )
      await user.click(screen.getByRole('option', { name: 'Multiply' }))

      await waitFor(() => {
        expect(savedWorkflow().pipeline.steps[0]).toMatchObject({
          blend: 'multiply',
        })
      })
    })

    it('adds a group, then steps into it, and gives it a picture of its own', async () => {
      const user = userEvent.setup()
      await renderPage(createWorkflow('Test'))

      await user.click(
        within(palette()).getByRole('button', { name: 'Add Group' }),
      )
      await user.click(
        within(palette()).getByRole('button', { name: 'Add Blur' }),
      )
      await clickStep('Group')
      await user.click(
        within(inspector()).getByRole('switch', { name: 'Own picture' }),
      )

      await waitFor(() => {
        const group = savedWorkflow().pipeline.steps.at(-1)
        expect(group).toMatchObject({ kind: 'group', subDocument: true })
        expect(group?.kind === 'group' && group.steps).toHaveLength(1)
      })
    })
  })

  describe('actions on a step', () => {
    it('switches a step off and on', async () => {
      const user = userEvent.setup()
      await renderPage(createWorkflow('Test'))
      await clickStep('Image layer')

      await user.click(
        within(inspector()).getByRole('button', {
          name: 'Hide Image layer',
        }),
      )

      await waitFor(() => {
        expect(savedWorkflow().pipeline.steps[0]).toMatchObject({
          enabled: false,
        })
      })
    })

    it('moves a step earlier and later', async () => {
      const user = userEvent.setup()
      await renderPage(createWorkflow('Test'))
      await user.click(
        within(palette()).getByRole('button', { name: 'Add Blur' }),
      )

      await user.click(
        within(inspector()).getByRole('button', { name: 'Move Blur earlier' }),
      )
      await waitFor(() => {
        expect(stepKinds()).toEqual(['blur', IMAGE_LAYER_KIND])
      })

      await user.click(
        within(inspector()).getByRole('button', { name: 'Move Blur later' }),
      )
      await waitFor(() => {
        expect(stepKinds()).toEqual([IMAGE_LAYER_KIND, 'blur'])
      })
    })
  })

  describe('canvas', () => {
    it('changes the size and the background of the canvas', async () => {
      const user = userEvent.setup()
      await renderPage(createWorkflow('Test'))
      await clickStep('Canvas')
      const panel = inspector()

      const width = within(panel).getByLabelText('Width (px)')
      await user.clear(width)
      await user.type(width, '800')
      await user.click(
        within(panel).getByRole('switch', { name: 'Transparent background' }),
      )
      await user.click(
        within(panel).getByRole('button', { name: 'Apply canvas' }),
      )

      await waitFor(() => {
        expect(savedWorkflow().pipeline.canvas).toEqual({
          width: 800,
          height: 1080,
          background: '#ffffff',
        })
      })
    })

    it('refuses a canvas that is not valid, and saves nothing', async () => {
      const user = userEvent.setup()
      await renderPage(createWorkflow('Test'))
      await clickStep('Canvas')
      const panel = inspector()

      const width = within(panel).getByLabelText('Width (px)')
      await user.clear(width)
      await user.type(width, '0')
      await user.click(
        within(panel).getByRole('button', { name: 'Apply canvas' }),
      )

      expect(await within(panel).findByRole('alert')).toBeInTheDocument()
      expect(changeWorkflow).not.toHaveBeenCalled()
    })
  })

  describe('save status and the Edit history', () => {
    it('says when the workflow is saved after a change', async () => {
      const user = userEvent.setup()
      await renderPage(createWorkflow('Test'))
      expect(within(runTab()).getByRole('status')).toHaveTextContent('Saved')

      await user.click(
        within(palette()).getByRole('button', { name: 'Add Resize' }),
      )

      await waitFor(() => {
        expect(changeWorkflow).toHaveBeenCalledTimes(1)
      })
      await within(runTab()).findByText('Saved')
      expect(
        vi.mocked(changeWorkflow).mock.calls.at(-1)?.[0].data.revision,
      ).toBe(0)
    })

    it('sends the revision of the last save with the next one', async () => {
      const user = userEvent.setup()
      await renderPage(createWorkflow('Test'))

      await user.click(
        within(palette()).getByRole('button', { name: 'Add Resize' }),
      )
      await waitFor(() => {
        expect(changeWorkflow).toHaveBeenCalledTimes(1)
      })
      await within(runTab()).findByText('Saved')
      await user.click(
        within(palette()).getByRole('button', { name: 'Add Rotate' }),
      )

      await waitFor(() => {
        expect(changeWorkflow).toHaveBeenCalledTimes(2)
      })
      expect(
        vi.mocked(changeWorkflow).mock.calls.at(-1)?.[0].data.revision,
      ).toBe(1)
    })

    it('says why saving failed and shows the workflow the server holds', async () => {
      vi.mocked(changeWorkflow).mockRejectedValue(
        new Error('This workflow was changed somewhere else.'),
      )
      const user = userEvent.setup()
      await renderPage(createWorkflow('Test'))

      await user.click(
        within(palette()).getByRole('button', { name: 'Add Resize' }),
      )

      expect(
        await within(runTab()).findByText(
          'Not saved: This workflow was changed somewhere else.',
        ),
      ).toBeInTheDocument()
      await waitFor(() => {
        expect(within(canvas()).queryByText('Resize')).not.toBeInTheDocument()
      })
    })

    it('undoes and redoes a change from the Edit history, and says when there is nothing to', async () => {
      const user = userEvent.setup()
      await renderPage(createWorkflow('Test'))
      expect(
        within(runTab()).getByRole('button', { name: 'Undo' }),
      ).toBeDisabled()
      expect(
        within(runTab()).getByRole('button', { name: 'Redo' }),
      ).toBeDisabled()

      await user.click(
        within(palette()).getByRole('button', { name: 'Add Resize' }),
      )
      await within(canvas()).findByText('Resize')
      await user.click(within(runTab()).getByRole('button', { name: 'Undo' }))

      await waitFor(() => {
        expect(within(canvas()).queryByText('Resize')).not.toBeInTheDocument()
      })
      expect(savedWorkflow().pipeline.steps).toHaveLength(1)
      await user.click(within(runTab()).getByRole('button', { name: 'Redo' }))

      expect(await within(canvas()).findByText('Resize')).toBeInTheDocument()
      expect(savedWorkflow().pipeline.steps).toHaveLength(2)
      expect(
        within(runTab()).getByRole('button', { name: 'Redo' }),
      ).toBeDisabled()
    })

    it('keeps changes that were not saved yet in the Edit history in order', async () => {
      const user = userEvent.setup()
      await renderPage(createWorkflow('Test'))

      await user.click(
        within(palette()).getByRole('button', { name: 'Add Resize' }),
      )
      await user.click(
        within(palette()).getByRole('button', { name: 'Add Rotate' }),
      )

      await waitFor(() => {
        expect(server.entries).toHaveLength(2)
      })
      expect(stepKinds()).toEqual(['image-layer', 'resize', 'rotate'])
    })
  })

  describe('runs', () => {
    it('saves, then starts a run', async () => {
      vi.mocked(runWorkflow).mockResolvedValue(run({ state: RunState.Running }))
      const user = userEvent.setup()
      await renderPage(createWorkflow('Test'))
      await user.click(
        within(palette()).getByRole('button', { name: 'Add Resize' }),
      )

      await user.click(within(runTab()).getByRole('button', { name: 'Run' }))

      expect(changeWorkflow).toHaveBeenCalled()
      expect(runWorkflow).toHaveBeenCalledWith({
        data: { id: expect.any(String), canvas: RunCanvasMode.Workflow },
      })
      const saveOrder =
        vi.mocked(changeWorkflow).mock.invocationCallOrder[0] ?? 0
      const runOrder = vi.mocked(runWorkflow).mock.invocationCallOrder[0] ?? 0
      expect(saveOrder).toBeLessThan(runOrder)
    })

    it('runs on a canvas the size of each image when asked to', async () => {
      vi.mocked(runWorkflow).mockResolvedValue(run({ state: RunState.Running }))
      const user = userEvent.setup()
      await renderPage(createWorkflow('Test'))

      await user.click(
        within(runTab()).getByRole('combobox', { name: 'Run on' }),
      )
      await user.click(
        screen.getByRole('option', { name: 'Size of each image' }),
      )
      await user.click(within(runTab()).getByRole('button', { name: 'Run' }))

      await waitFor(() => {
        expect(runWorkflow).toHaveBeenCalledWith({
          data: { id: expect.any(String), canvas: RunCanvasMode.FirstImage },
        })
      })
    })

    it('says why a run could not start', async () => {
      vi.mocked(runWorkflow).mockRejectedValue(
        new Error('Add at least one image to run the workflow on.'),
      )
      const user = userEvent.setup()
      await renderPage(createWorkflow('Test'))

      await user.click(within(runTab()).getByRole('button', { name: 'Run' }))

      const runs = within(runTab()).getByRole('region', { name: 'Runs' })
      expect(await within(runs).findByRole('alert')).toHaveTextContent(
        'Add at least one image',
      )
    })

    it('shows a running run with its progress and cancels it', async () => {
      vi.mocked(listWorkflowRuns).mockResolvedValue([
        run({
          state: RunState.Running,
          progress: 0.5,
          jobs: {
            total: 2,
            waiting: 0,
            running: 1,
            done: 1,
            failed: 0,
            cancelled: 0,
          },
        }),
      ])
      vi.mocked(cancelWorkflowRun).mockResolvedValue(
        run({ state: RunState.Cancelled }),
      )
      const user = userEvent.setup()
      await renderPage(createWorkflow('Test'))
      const runs = within(runTab()).getByRole('region', { name: 'Runs' })

      expect(await within(runs).findByText(/Running · 50%/)).toBeInTheDocument()
      await user.click(within(runs).getByRole('button', { name: 'Cancel' }))

      expect(cancelWorkflowRun).toHaveBeenCalledWith({ data: { id: 'run-1' } })
    })

    it('offers the finished images to download, and deletes the run', async () => {
      vi.mocked(listWorkflowRuns).mockResolvedValue([run({})])
      vi.mocked(listResults).mockResolvedValue([
        {
          id: 'res-1',
          kind: 'run-item',
          fileName: 'a-480.webp',
          mediaType: 'image/webp',
          bytes: 10,
          documentId: null,
          stepId: null,
          workflowRunId: 'run-1',
          createdAt: NOW,
        },
      ])
      vi.mocked(deleteWorkflowRun).mockResolvedValue(undefined)
      const user = userEvent.setup()
      await renderPage(createWorkflow('Test'))
      const runs = within(runTab()).getByRole('region', { name: 'Runs' })

      await user.click(
        await within(runs).findByRole('button', { name: 'Show images' }),
      )

      const link = await within(runs).findByRole('link', {
        name: 'a-480.webp',
      })
      expect(link).toHaveAttribute('href', '/api/results/res-1')
      expect(link).toHaveAttribute('download', 'a-480.webp')

      await user.click(within(runs).getByRole('button', { name: 'Delete' }))
      expect(deleteWorkflowRun).toHaveBeenCalledWith({ data: { id: 'run-1' } })
    })
  })
})
