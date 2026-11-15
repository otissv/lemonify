import { RiAddLine } from '@remixicon/react'
import { useRouter } from '@tanstack/react-router'
import { useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  WorkflowNameSchema,
  nextWorkflowName,
} from '@/features/workflows/workflow'
import {
  createWorkflowFn,
  listWorkflows,
} from '@/features/workflows/workflow-functions'
import { errorMessage } from '@/lib/error-message'

const CREATE_FAILED = 'The workflow could not be created.'

interface AddWorkflowDialogProps {
  /** What opens the dialog; a plain "Add workflow" button when none is given. */
  trigger?: React.ReactNode
}

/** Asks for a name, creates the workflow on the server and opens it. */
export function AddWorkflowDialog({
  trigger,
}: AddWorkflowDialogProps): React.JSX.Element {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputId = useId()
  const problemId = useId()

  async function handleOpenChange(next: boolean): Promise<void> {
    setOpen(next)
    if (!next) return
    setProblem(null)
    setName('')
    try {
      setName(nextWorkflowName(await listWorkflows()))
    } catch {
      setName(nextWorkflowName([]))
    }
  }

  function handleNameChange(event: React.ChangeEvent<HTMLInputElement>): void {
    setName(event.target.value)
    setProblem(null)
  }

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault()
    const parsed = WorkflowNameSchema.safeParse(name)
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? 'Enter a name.')
      return
    }
    setBusy(true)
    try {
      const created = await createWorkflowFn({ data: { name: parsed.data } })
      setOpen(false)
      await router.invalidate()
      await router.navigate({
        to: '/workflows/$id',
        params: { id: created.id },
      })
    } catch (caught) {
      setProblem(errorMessage(caught, CREATE_FAILED))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => void handleOpenChange(next)}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <RiAddLine aria-hidden="true" />
            Add workflow
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(event) => void handleSubmit(event)}
          noValidate
          className="flex flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>Add workflow</DialogTitle>
            <DialogDescription>Give the new workflow a name.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor={inputId}>Name</Label>
            <Input
              id={inputId}
              value={name}
              onChange={handleNameChange}
              autoComplete="off"
              aria-invalid={problem !== null}
              aria-describedby={problem ? problemId : undefined}
            />
            {problem && (
              <p id={problemId} className="text-body-md text-destructive">
                {problem}
              </p>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={busy}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
