/**
 * ScoreBreakdown component tests — sorting, expand/collapse, empty state.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ScoreBreakdown from '@/components/ScoreBreakdown'
import type { ScoreFactor } from '@/lib/api'

const FACTORS: ScoreFactor[] = [
  { factor: 'Nutri-Score E', impact: -25, reason: 'Poor quality' },
  { factor: 'High sugar', impact: -15, reason: 'Diabetes penalty' },
  { factor: 'High fiber', impact: 5, reason: 'Satiety bonus' },
]

describe('ScoreBreakdown', () => {
  it('is collapsed by default', () => {
    render(<ScoreBreakdown factors={FACTORS} />)
    expect(screen.queryByTestId('score-factor')).not.toBeInTheDocument()
    expect(screen.getByText('Show')).toBeInTheDocument()
  })

  it('expands on click and reveals factors sorted by absolute impact', async () => {
    const user = userEvent.setup()
    render(<ScoreBreakdown factors={FACTORS} />)
    await user.click(screen.getByRole('button', { name: /score breakdown/i }))
    const items = screen.getAllByTestId('score-factor')
    expect(items.map((el) => el.textContent)).toEqual([
      expect.stringContaining('Nutri-Score E'),
      expect.stringContaining('High sugar'),
      expect.stringContaining('High fiber'),
    ])
  })

  it('renders open by default when defaultOpen', () => {
    render(<ScoreBreakdown factors={FACTORS} defaultOpen />)
    expect(screen.getAllByTestId('score-factor')).toHaveLength(3)
    expect(screen.getByText('Hide')).toBeInTheDocument()
  })

  it('renders an empty-state message when there are no factors', () => {
    render(<ScoreBreakdown factors={[]} defaultOpen />)
    expect(
      screen.getByText(/no factors contributed/i),
    ).toBeInTheDocument()
  })

  it('formats positive impacts with +', () => {
    render(<ScoreBreakdown factors={[FACTORS[2]]} defaultOpen />)
    expect(screen.getByText('+5')).toBeInTheDocument()
  })

  it('formats negative impacts with -', () => {
    render(<ScoreBreakdown factors={[FACTORS[0]]} defaultOpen />)
    expect(screen.getByText('-25')).toBeInTheDocument()
  })

  it('toggle button has aria-expanded', async () => {
    const user = userEvent.setup()
    render(<ScoreBreakdown factors={FACTORS} />)
    const btn = screen.getByRole('button', { name: /score breakdown/i })
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    await user.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
  })
})
