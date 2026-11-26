import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface CreateFromShellProps {
  title: string
  description: string
  /** What the button that sends the form says. */
  submitLabel?: string
  /** Why the last try failed, shown above the buttons. */
  problem: string | undefined
  /** While the source loads or the new item is made: the form cannot be sent. */
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: () => void
  children: React.ReactNode
}

/** The dialog every create-from form sits in: its title, the fields it is given, a problem line, and Cancel and Create. */
export function CreateFromShell({
  title,
  description,
  submitLabel = 'Create',
  problem,
  busy,
  onOpenChange,
  onSubmit,
  children,
}: CreateFromShellProps): React.JSX.Element {
  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    onSubmit()
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={handleSubmit}
          noValidate
          className="flex flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {children}
          {problem !== undefined && (
            <p role="alert" className="text-body-md text-destructive">
              {problem}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={busy}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
