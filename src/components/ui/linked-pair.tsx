import { cn } from '@/lib/utils'

/** Two fields side by side with what links them, such as a chain, in the narrow column between: first field, link, second field. */
export function LinkedPair({
  className,
  ...props
}: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="linked-pair"
      className={cn(
        'grid grid-cols-[1fr_auto_1fr] items-start gap-2',
        className,
      )}
      {...props}
    />
  )
}
