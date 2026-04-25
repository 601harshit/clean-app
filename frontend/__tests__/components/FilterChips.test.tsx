/**
 * FilterChips component tests (TDD).
 *
 * Renders the row of active-filter pills above the search results, with
 * a × button on each that calls onRemove(filter). Also includes a
 * "Clear all" button that calls onClearAll.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { FilterChips, type ActiveFilters } from '@/components/FilterChips'

const allFilters: ActiveFilters = {
  category: 'snacks',
  min_score: 60,
  safe_for: ['diabetes', 'hypertension'],
  nutri_score: ['A', 'B'],
  nova_group: [1, 2],
}

describe('FilterChips', () => {
  it('renders nothing when no filters are active', () => {
    const { container } = render(
      <FilterChips
        filters={{}}
        onRemove={() => {}}
        onClearAll={() => {}}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders one chip per active filter (multi-select expanded)', () => {
    render(
      <FilterChips
        filters={allFilters}
        onRemove={() => {}}
        onClearAll={() => {}}
      />,
    )
    expect(screen.getByText(/snacks/i)).toBeInTheDocument()
    expect(screen.getByText(/good\+/i)).toBeInTheDocument() // min_score=60
    expect(screen.getByText(/safe for diabetes/i)).toBeInTheDocument()
    expect(screen.getByText(/safe for hypertension/i)).toBeInTheDocument()
    expect(screen.getByText(/nutri-score a/i)).toBeInTheDocument()
    expect(screen.getByText(/nutri-score b/i)).toBeInTheDocument()
    expect(screen.getByText(/nova 1/i)).toBeInTheDocument()
    expect(screen.getByText(/nova 2/i)).toBeInTheDocument()
  })

  it('shows "Excellent" label for min_score=80', () => {
    render(
      <FilterChips
        filters={{ min_score: 80 }}
        onRemove={() => {}}
        onClearAll={() => {}}
      />,
    )
    expect(screen.getByText(/excellent/i)).toBeInTheDocument()
  })

  it('clicking the × on a chip calls onRemove with that filter descriptor', async () => {
    const onRemove = jest.fn()
    const user = userEvent.setup()
    render(
      <FilterChips
        filters={{ safe_for: ['diabetes'] }}
        onRemove={onRemove}
        onClearAll={() => {}}
      />,
    )
    await user.click(screen.getByRole('button', { name: /remove safe for diabetes/i }))
    expect(onRemove).toHaveBeenCalledWith({ key: 'safe_for', value: 'diabetes' })
  })

  it('removing min_score sends key only (no value)', async () => {
    const onRemove = jest.fn()
    const user = userEvent.setup()
    render(
      <FilterChips
        filters={{ min_score: 60 }}
        onRemove={onRemove}
        onClearAll={() => {}}
      />,
    )
    await user.click(screen.getByRole('button', { name: /remove good\+/i }))
    expect(onRemove).toHaveBeenCalledWith({ key: 'min_score' })
  })

  it('"Clear all" button calls onClearAll', async () => {
    const onClearAll = jest.fn()
    const user = userEvent.setup()
    render(
      <FilterChips
        filters={allFilters}
        onRemove={() => {}}
        onClearAll={onClearAll}
      />,
    )
    await user.click(screen.getByRole('button', { name: /clear all/i }))
    expect(onClearAll).toHaveBeenCalledTimes(1)
  })

  it('does not render Clear all button when only one chip is shown', () => {
    render(
      <FilterChips
        filters={{ category: 'dairy' }}
        onRemove={() => {}}
        onClearAll={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: /clear all/i })).not.toBeInTheDocument()
  })

  it('renders nutri-score chip with the spec colour', () => {
    render(
      <FilterChips
        filters={{ nutri_score: ['A'] }}
        onRemove={() => {}}
        onClearAll={() => {}}
      />,
    )
    const chip = screen.getByTestId('chip-nutri_score-A')
    expect(chip.className).toMatch(/bg-green-600/)
  })
})
