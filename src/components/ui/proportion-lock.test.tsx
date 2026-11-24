import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { ProportionLock } from '@/components/ui/proportion-lock'

function Harness(): React.JSX.Element {
  const [locked, setLocked] = useState(true)
  return (
    <ProportionLock
      label="Keep proportions"
      locked={locked}
      onLockedChange={setLocked}
    />
  )
}

describe('ProportionLock', () => {
  it('is a chain that is pressed while locked and lets go when clicked', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const chain = screen.getByRole('button', { name: 'Keep proportions' })
    expect(chain).toHaveAttribute('aria-pressed', 'true')

    await user.click(chain)
    expect(chain).toHaveAttribute('aria-pressed', 'false')

    await user.click(chain)
    expect(chain).toHaveAttribute('aria-pressed', 'true')
  })
})
