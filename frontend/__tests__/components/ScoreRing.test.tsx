/**
 * ScoreRing component tests.
 *
 * Verifies color band, clamping, label rendering, and accessibility.
 */

import { render, screen } from '@testing-library/react'
import ScoreRing from '@/components/ScoreRing'

function renderRing(score: number, label?: string) {
  return render(<ScoreRing score={score} label={label} />)
}

describe('ScoreRing', () => {
  it('renders the score number', () => {
    renderRing(72)
    expect(screen.getByTestId('score-value')).toHaveTextContent('72')
  })

  it('renders the label when provided', () => {
    renderRing(85, 'Excellent')
    expect(screen.getByText('Excellent')).toBeInTheDocument()
  })

  it.each([
    [100, 'rgb(22, 163, 74)'],
    [80, 'rgb(22, 163, 74)'],
    [60, 'rgb(22, 163, 74)'],
    [59, 'rgb(234, 179, 8)'],
    [40, 'rgb(234, 179, 8)'],
    [39, 'rgb(220, 38, 38)'],
    [0, 'rgb(220, 38, 38)'],
  ])('uses the right color band for score %i', (score, expectedColor) => {
    renderRing(score)
    const value = screen.getByTestId('score-value')
    // tone-checking via inline style.color (component sets it explicitly)
    const wrapper = value.parentElement!
    expect(wrapper).toHaveStyle({ color: expectedColor })
  })

  it('clamps scores below 0 to 0', () => {
    renderRing(-10)
    expect(screen.getByTestId('score-value')).toHaveTextContent('0')
  })

  it('clamps scores above 100 to 100', () => {
    renderRing(150)
    expect(screen.getByTestId('score-value')).toHaveTextContent('100')
  })

  it('rounds fractional scores', () => {
    renderRing(72.4)
    expect(screen.getByTestId('score-value')).toHaveTextContent('72')
    renderRing(72.6)
    expect(screen.getAllByTestId('score-value')[1]).toHaveTextContent('73')
  })

  it('exposes an accessible label that includes score and label', () => {
    renderRing(50, 'Fair')
    expect(screen.getByRole('img')).toHaveAccessibleName(
      /score 50.*100.*Fair/i,
    )
  })

  it('omits label from a11y name when not provided', () => {
    renderRing(50)
    expect(screen.getByRole('img')).toHaveAccessibleName(/score 50.*100/i)
  })
})
