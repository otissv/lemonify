import {
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AiToolId, AI_TOOLS } from '@/features/ai/ai-tools'
import { getExportFormats } from '@/features/export/export-functions'
import { ExportFormat } from '@/features/export/export-settings'
import { listResults } from '@/features/results/result-functions'
import { listSources } from '@/features/sources/source-functions'
import type { UpscaleCatalogue } from '@/features/upscale/upscale-settings'
import type { AiToolEntry } from '@/features/workflows/ai-tool-entries'
import type { OutputSettings } from '@/features/workflows/output-settings'
import {
  INITIAL_SOURCES_STATE,
  useSourcesStore,
} from '@/features/workflows/sources-store'
import { WorkflowSchema, createWorkflow } from '@/features/workflows/workflow'
import type { Workflow } from '@/features/workflows/workflow'
import {
  cancelWorkflowRun,
  deleteWorkflowRun,
  getWorkflow,
  listWorkflowRuns,
  runWorkflow,
  updateWorkflow,
} from '@/features/workflows/workflow-functions'
import {
  WorkflowNodeKind,
  pipelineSteps,
} from '@/features/workflows/workflow-graph'
import { WorkflowPage } from '@/features/workflows/workflow-page'
import { RunState } from '@/server/dao/workflow-dao'
import type { RunView } from '@/server/services/workflow-service'

vi.mock('@/features/workflows/workflow-functions', () => ({
  getWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
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

function viewOf(workflow: Workflow, revision: number) {
  return { ...workflow, revision, createdAt: NOW, updatedAt: NOW }
}

function run(overrides: Partial<RunView>): RunView {
  return {
    id: 'run-1',
    workflowId: 'wf',
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

/** The workflow as the last save sent it to the server. */
function savedWorkflow(): Workflow {
  const call = vi.mocked(updateWorkflow).mock.calls.at(-1)
  if (!call) throw new Error('Nothing was saved')
  const { id, name, graph } = call[0].data
  return WorkflowSchema.parse({ id, name, ...graph })
}

async function renderPage(workflow: Workflow): Promise<void> {
  vi.mocked(getWorkflow).mockResolvedValue(viewOf(workflow, 0))
  render(<WorkflowPage id={workflow.id} aiTools={AI_TOOL_ENTRIES} />)
  await screen.findByRole('heading', { name: workflow.name })
}

/**
 * Selects a step on the canvas. A plain click event is used because
 * user-event's mouse-down has no `view`, which React Flow's drag handling
 * (d3-drag) requires; selecting needs only the click.
 */
/** Selects a step; the canvas takes a moment to attach its handlers, so the click is repeated until the options show the step. */
async function clickStep(name: string): Promise<void> {
  await waitFor(() => {
    const canvas = screen.getByRole('application', { name: 'Workflow canvas' })
    fireEvent.click(within(canvas).getByText(name))
    expect(
      screen.getByRole('region', { name: 'Step options' }),
    ).not.toHaveTextContent('Select a step')
  })
}

function palette(): HTMLElement {
  return screen.getByRole('region', { name: 'Steps' })
}

function inspector(): HTMLElement {
  return screen.getByRole('region', { name: 'Step options' })
}

/** Saves wait for the autosave delay, so waiting for them needs more than the default second. */
const SAVE_WAIT_MS = 4000

describe('WorkflowPage', () => {
  beforeAll(() => {
    configure({ asyncUtilTimeout: SAVE_WAIT_MS })
  })

  beforeEach(() => {
    useSourcesStore.setState(INITIAL_SOURCES_STATE)
    vi.mocked(getExportFormats).mockResolvedValue([
      ExportFormat.Original,
      ExportFormat.Jpeg,
      ExportFormat.Png,
      ExportFormat.Webp,
    ])
    vi.mocked(listSources).mockResolvedValue([PHOTO_A, PHOTO_B])
    vi.mocked(listWorkflowRuns).mockResolvedValue([])
    vi.mocked(listResults).mockResolvedValue([])
    vi.mocked(updateWorkflow).mockImplementation(async ({ data }) => ({
      ...viewOf(
        WorkflowSchema.parse({ id: data.id, name: data.name, ...data.graph }),
        data.revision + 1,
      ),
    }))
  })

  it('names the workflow', async () => {
    await renderPage(createWorkflow('Sharpen photos'))

    expect(
      screen.getByRole('heading', { name: 'Sharpen photos' }),
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

  it('shows the Input and Output steps on the canvas', async () => {
    await renderPage(createWorkflow('Test'))
    const canvas = screen.getByRole('application', { name: 'Workflow canvas' })

    expect(within(canvas).getByText('Input')).toBeInTheDocument()
    expect(within(canvas).getByText('Output')).toBeInTheDocument()
  })

  describe('output', () => {
    async function selectOutput(): Promise<HTMLElement> {
      await clickStep('Output')
      return inspector()
    }

    function outputSettings(_id: string): OutputSettings | undefined {
      const output = savedWorkflow().nodes.find(
        (node) => node.kind === WorkflowNodeKind.Output,
      )
      return output?.kind === WorkflowNodeKind.Output
        ? output.settings
        : undefined
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
        expect(outputSettings(workflow.id)?.format).toBe(ExportFormat.Png)
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
          expect(outputSettings(workflow.id)?.widths).toEqual([480, 768])
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
          expect(outputSettings(workflow.id)?.widths).toEqual([
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
          expect(outputSettings(workflow.id)?.widths).toEqual([480, 1024, 1440])
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
      await clickStep('Input')
      return inspector()
    }

    function inputSourceIds(): ReadonlyArray<string> {
      const input = savedWorkflow().nodes.find(
        (node) => node.kind === WorkflowNodeKind.Input,
      )
      return input?.kind === WorkflowNodeKind.Input ? input.sourceIds : []
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
      expect(
        within(
          screen.getByRole('application', { name: 'Workflow canvas' }),
        ).getByText('1 image'),
      ).toBeInTheDocument()
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
      await clickStep('Input')
      await user.click(
        within(palette()).getByRole('button', { name: 'Add Sharpen' }),
      )

      await waitFor(() => {
        const ops: Array<string> = []
        for (const node of pipelineSteps(savedWorkflow())) {
          ops.push(node.kind === WorkflowNodeKind.Sharp ? node.op : node.kind)
        }
        expect(ops).toEqual(['input', 'sharpen', 'resize', 'rotate', 'output'])
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

    it('offers AI upscale and every group of Sharp ops from the image CLI', async () => {
      await renderPage(createWorkflow('Test'))

      for (const group of ['AI', 'Geometry', 'Filters', 'Colour', 'Output']) {
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
    })

    it('adds a step to the end of the pipeline and selects it', async () => {
      const workflow = createWorkflow('Test')
      const user = userEvent.setup()
      await renderPage(workflow)

      await user.click(
        within(palette()).getByRole('button', { name: 'Add Resize' }),
      )

      await waitFor(() => {
        const steps = pipelineSteps(savedWorkflow())
        expect(steps.map((node) => node.kind)).toEqual([
          WorkflowNodeKind.Input,
          WorkflowNodeKind.Sharp,
          WorkflowNodeKind.Output,
        ])
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
      const step = savedWorkflow().nodes.find(
        (node) => node.kind === WorkflowNodeKind.Sharp,
      )
      return step?.kind === WorkflowNodeKind.Sharp ? step.options : undefined
    }

    it('asks for something to be selected at first', async () => {
      await renderPage(createWorkflow('Test'))

      expect(inspector()).toHaveTextContent('Select a step')
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
        const step = savedWorkflow().nodes.find((node) => node.kind === 'ai')
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
        expect(savedWorkflow().nodes).toHaveLength(2)
      })
      expect(inspector()).toHaveTextContent('Select a step')
    })
  })

  describe('save status', () => {
    it('says when the workflow is saved after a change', async () => {
      const user = userEvent.setup()
      await renderPage(createWorkflow('Test'))
      expect(screen.getByRole('status', { name: '' })).toBeDefined()

      await user.click(
        within(palette()).getByRole('button', { name: 'Add Resize' }),
      )

      await waitFor(() => {
        expect(screen.getByText('Saved')).toBeInTheDocument()
      })
      expect(
        vi.mocked(updateWorkflow).mock.calls.at(-1)?.[0].data.revision,
      ).toBe(0)
    })

    it('sends the revision of the last save with the next one', async () => {
      const user = userEvent.setup()
      await renderPage(createWorkflow('Test'))

      await user.click(
        within(palette()).getByRole('button', { name: 'Add Resize' }),
      )
      await waitFor(() => {
        expect(updateWorkflow).toHaveBeenCalledTimes(1)
      })
      await screen.findByText('Saved')
      await user.click(
        within(palette()).getByRole('button', { name: 'Add Rotate' }),
      )

      await waitFor(() => {
        expect(updateWorkflow).toHaveBeenCalledTimes(2)
      })
      expect(
        vi.mocked(updateWorkflow).mock.calls.at(-1)?.[0].data.revision,
      ).toBe(1)
    })

    it('says why saving failed and reloads the saved workflow on request', async () => {
      vi.mocked(updateWorkflow).mockRejectedValue(
        new Error('This workflow was changed somewhere else.'),
      )
      const user = userEvent.setup()
      const workflow = createWorkflow('Test')
      await renderPage(workflow)

      await user.click(
        within(palette()).getByRole('button', { name: 'Add Resize' }),
      )

      expect(
        await screen.findByText(
          'Not saved: This workflow was changed somewhere else.',
        ),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()

      await user.click(screen.getByRole('button', { name: 'Reload' }))

      await waitFor(() => {
        expect(screen.getByText('Saved')).toBeInTheDocument()
      })
      expect(getWorkflow).toHaveBeenCalledTimes(2)
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

      await user.click(screen.getByRole('button', { name: 'Run' }))

      expect(updateWorkflow).toHaveBeenCalled()
      expect(runWorkflow).toHaveBeenCalledWith({
        data: { id: expect.any(String) },
      })
      const saveOrder =
        vi.mocked(updateWorkflow).mock.invocationCallOrder[0] ?? 0
      const runOrder = vi.mocked(runWorkflow).mock.invocationCallOrder[0] ?? 0
      expect(saveOrder).toBeLessThan(runOrder)
    })

    it('says why a run could not start', async () => {
      vi.mocked(runWorkflow).mockRejectedValue(
        new Error('Connect every step from Input to Output.'),
      )
      const user = userEvent.setup()
      await renderPage(createWorkflow('Test'))

      await user.click(screen.getByRole('button', { name: 'Run' }))

      const runs = screen.getByRole('region', { name: 'Runs' })
      expect(await within(runs).findByRole('alert')).toHaveTextContent(
        'Connect every step',
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
      const runs = screen.getByRole('region', { name: 'Runs' })

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
      const runs = screen.getByRole('region', { name: 'Runs' })

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
