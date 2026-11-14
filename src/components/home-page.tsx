import { RiArrowRightLine } from '@remixicon/react'

import { Button } from '@/components/ui/button'

export function HomePage(): React.JSX.Element {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold tracking-tight">Lemonify</h1>
      <Button>
        Get started
        <RiArrowRightLine aria-hidden="true" />
      </Button>
    </main>
  )
}
