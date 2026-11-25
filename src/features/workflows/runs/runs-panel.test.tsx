import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RunsPanel } from '@/features/workflows/runs/runs-panel'
import {
  cancelWorkflowRun,
  deleteWorkflowRun,
  listWorkflowRuns,
} from '@/features/workflows/workflow-functions'
import { RunState } from '@/server/dao/workflow-dao'
import type { RunView } from '@/server/services/workflow-service'
import { RunItemState } from '@/server/workflows/run-items'
import { INITIAL_LIBRARY_STATE, useLibraryStore } from '@/store/library-store'
import { resetStores } from '@/store/reset-stores'

vi.mock('@/features/workflows/workflow-functions', () => ({
  listWorkflowRuns: vi.fn(),
  runWorkflow: vi.fn(),
  cancelWorkflowRun: vi.fn(),
  deleteWorkflowRun: vi.fn(),
}))

const WORKFLOW_ID = 'wf'
const NOW = '2026-01-01T14:02:00.000Z'
const INPUTS = ['a', 'b', 'c']

function run(overrides: Partial<RunView> = {}): RunView {
  return {
    id: 'run-1',
    workflowId: WORKFLOW_ID,
    sourceIds: INPUTS,
    state: RunState.Done,
    createdAt: NOW,
    finishedAt: NOW,
    jobs: {
      total: 3,
      waiting: 0,
      running: 0,
      done: 3,
      failed: 0,
      cancelled: 0,
    },
    progress: 1,
    errors: [],
    items: INPUTS.map((sourceId) => ({
      sourceId,
      state: RunItemState.Done,
      resultIds: [`res-${sourceId}`],
    })),
    ...overrides,
  }
}

function seedRuns(runs: RunView[]): void {
  useLibraryStore.setState({ runs: { [WORKFLOW_ID]: runs } })
}

function imageName(id: string): string {
  return `${id}.png`
}

function renderPanel(
  onRun = vi.fn().mockResolvedValue(undefined),
  inputs: ReadonlyArray<string> = INPUTS,
) {
  render(
    <RunsPanel
      workflowId={WORKFLOW_ID}
      inputs={inputs}
      imageName={imageName}
      onRun={onRun}
    />,
  )
  return onRun
}

beforeEach(() => {
  resetStores()
  useLibraryStore.setState(INITIAL_LIBRARY_STATE)
  vi.mocked(listWorkflowRuns).mockResolvedValue([])
})

afterEach(() => {
  vi.resetAllMocks()
})

describe('RunsPanel', () => {
  describe('a new run', () => {
    it('starts on choosing images when there are no runs, with every input image chosen', () => {
      renderPanel()

      const picker = screen.getByRole('region', { name: 'New run' })
      for (const name of ['a.png', 'b.png', 'c.png']) {
        expect(within(picker).getByRole('checkbox', { name })).toBeChecked()
      }
      expect(within(picker).getByText('3 of 3 chosen')).toBeVisible()
      expect(
        within(picker).getByRole('button', { name: 'Run on 3 images' }),
      ).toBeEnabled()
    })

    it('runs on the images left chosen', async () => {
      const user = userEvent.setup()
      const onRun = renderPanel()
      const picker = screen.getByRole('region', { name: 'New run' })

      await user.click(within(picker).getByRole('checkbox', { name: 'b.png' }))
      await user.click(
        within(picker).getByRole('button', { name: 'Run on 2 images' }),
      )

      expect(onRun).toHaveBeenCalledWith(['a', 'c'])
    })

    it('chooses none or all, and finds images by name, choosing only those shown', async () => {
      const user = userEvent.setup()
      renderPanel()
      const picker = screen.getByRole('region', { name: 'New run' })
      const all = within(picker).getByRole('checkbox', { name: 'Select all' })

      await user.click(all)
      expect(within(picker).getByText('0 of 3 chosen')).toBeVisible()
      expect(
        within(picker).getByRole('button', { name: 'Run on 0 images' }),
      ).toBeDisabled()
      expect(
        within(picker).getByText('Choose at least one image.'),
      ).toBeVisible()

      await user.type(
        within(picker).getByRole('searchbox', { name: 'Search images' }),
        'b',
      )
      expect(
        within(picker).queryByRole('checkbox', { name: 'a.png' }),
      ).toBeNull()
      await user.click(all)
      expect(within(picker).getByText('1 of 3 chosen')).toBeVisible()
    })

    it('ticks a range with Shift and a click', () => {
      renderPanel()
      const picker = screen.getByRole('region', { name: 'New run' })
      fireEvent.click(
        within(picker).getByRole('checkbox', { name: 'Select all' }),
      )

      fireEvent.click(within(picker).getByRole('checkbox', { name: 'a.png' }))
      fireEvent.click(within(picker).getByRole('checkbox', { name: 'c.png' }), {
        shiftKey: true,
      })

      expect(within(picker).getByText('3 of 3 chosen')).toBeVisible()
    })

    it('says to add input images when the workflow has none', () => {
      renderPanel(vi.fn(), [])

      const picker = screen.getByRole('region', { name: 'New run' })
      expect(
        within(picker).getByText('Add input images to the workflow first.'),
      ).toBeVisible()
    })
  })

  describe('the runs', () => {
    it('lists each run, newest first, and shows the newest', () => {
      seedRuns([
        run({ id: 'run-2', state: RunState.Running, items: [] }),
        run({ id: 'run-1' }),
      ])
      renderPanel()

      const list = screen.getByRole('list', { name: 'Runs' })
      expect(
        within(list)
          .getAllByRole('button', { name: /^Run \d/ })
          .map((button) => button.textContent),
      ).toEqual([
        expect.stringContaining('Run 2'),
        expect.stringContaining('Run 1'),
      ])
      expect(screen.getByRole('heading', { name: 'Run 2' })).toBeVisible()
    })

    it('shows a running run’s progress and each image’s state, and stops it', async () => {
      seedRuns([
        run({
          state: RunState.Running,
          items: [
            { sourceId: 'a', state: RunItemState.Done, resultIds: ['res-a'] },
            { sourceId: 'b', state: RunItemState.Running, resultIds: [] },
            { sourceId: 'c', state: RunItemState.Waiting, resultIds: [] },
          ],
        }),
      ])
      vi.mocked(cancelWorkflowRun).mockResolvedValue(run())
      const user = userEvent.setup()
      renderPanel()
      const detail = screen.getByRole('region', { name: 'Run 1' })

      expect(
        within(detail).getByRole('progressbar', { name: 'Run progress' }),
      ).toHaveAttribute('value', '1')
      expect(within(detail).getByText('1 of 3 done')).toBeVisible()
      const images = within(detail).getByRole('list', { name: 'Images' })
      expect(within(images).getByText('Working')).toBeVisible()
      expect(within(images).getByText('Waiting')).toBeVisible()
      expect(
        within(images).getByRole('link', { name: 'Download a.png' }),
      ).toHaveAttribute('href', '/api/results/res-a')

      await user.click(within(detail).getByRole('button', { name: 'Stop' }))
      expect(cancelWorkflowRun).toHaveBeenCalledWith({ data: { id: 'run-1' } })
    })

    it('downloads a finished run as one zip, runs it again, retries the failed images and deletes it', async () => {
      seedRuns([
        run({
          state: RunState.Failed,
          errors: ['The image could not be read.'],
          items: [
            { sourceId: 'a', state: RunItemState.Done, resultIds: ['res-a'] },
            { sourceId: 'b', state: RunItemState.Failed, resultIds: [] },
            { sourceId: 'c', state: RunItemState.Done, resultIds: ['res-c'] },
          ],
        }),
      ])
      vi.mocked(deleteWorkflowRun).mockResolvedValue(undefined)
      const user = userEvent.setup()
      const onRun = renderPanel()
      const detail = screen.getByRole('region', { name: 'Run 1' })

      expect(within(detail).getByText('2 done, 1 failed')).toBeVisible()
      expect(within(detail).getByRole('alert')).toHaveTextContent(
        'The image could not be read.',
      )
      expect(
        within(detail).getByRole('link', { name: 'Download all' }),
      ).toHaveAttribute('href', '/api/workflow-runs/run-1/archive')

      await user.click(
        within(detail).getByRole('button', { name: 'More actions for Run 1' }),
      )
      await user.click(
        await screen.findByRole('menuitem', { name: 'Retry failed' }),
      )
      expect(onRun).toHaveBeenLastCalledWith(['b'])

      await user.click(
        within(detail).getByRole('button', { name: 'More actions for Run 1' }),
      )
      await user.click(
        await screen.findByRole('menuitem', { name: 'Run again' }),
      )
      expect(onRun).toHaveBeenLastCalledWith(['a', 'b', 'c'])

      await user.click(
        within(detail).getByRole('button', { name: 'More actions for Run 1' }),
      )
      await user.click(
        await screen.findByRole('menuitem', { name: 'Delete run' }),
      )
      expect(deleteWorkflowRun).toHaveBeenCalledWith({ data: { id: 'run-1' } })
    })

    it('runs again only on the images the workflow still has', async () => {
      seedRuns([run()])
      const user = userEvent.setup()
      const onRun = renderPanel(vi.fn().mockResolvedValue(undefined), ['c'])
      const detail = screen.getByRole('region', { name: 'Run 1' })

      await user.click(
        within(detail).getByRole('button', { name: 'More actions for Run 1' }),
      )
      await user.click(
        await screen.findByRole('menuitem', { name: 'Run again' }),
      )

      expect(onRun).toHaveBeenCalledWith(['c'])
    })

    it('says a stopped run stopped, and how far it got', () => {
      seedRuns([
        run({
          state: RunState.Cancelled,
          items: [
            { sourceId: 'a', state: RunItemState.Done, resultIds: ['res-a'] },
            { sourceId: 'b', state: RunItemState.Cancelled, resultIds: [] },
            { sourceId: 'c', state: RunItemState.Cancelled, resultIds: [] },
          ],
        }),
      ])
      renderPanel()

      expect(
        within(screen.getByRole('region', { name: 'Run 1' })).getByText(
          'Stopped at 1 of 3',
        ),
      ).toBeVisible()
    })

    it('opens a new run from the list, and goes back to the runs', async () => {
      seedRuns([run()])
      const user = userEvent.setup()
      renderPanel()

      await user.click(screen.getByRole('button', { name: 'New run' }))
      expect(screen.getByRole('region', { name: 'New run' })).toBeVisible()
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.getByRole('region', { name: 'Run 1' })).toBeVisible()
    })

    it('shows the newest run once a run has started', async () => {
      const user = userEvent.setup()
      const onRun = vi.fn(async () => {
        seedRuns([run({ id: 'run-9', state: RunState.Running })])
      })
      renderPanel(onRun)

      await user.click(screen.getByRole('button', { name: 'Run on 3 images' }))

      expect(await screen.findByRole('region', { name: 'Run 1' })).toBeVisible()
    })

    it('says why a run could not start', () => {
      useLibraryStore.setState({
        runErrors: { [WORKFLOW_ID]: 'Add at least one image.' },
      })
      renderPanel()

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Add at least one image.',
      )
    })
  })
})
