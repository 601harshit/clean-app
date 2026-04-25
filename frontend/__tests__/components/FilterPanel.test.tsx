/**
 * FilterPanel component tests (TDD).
 *
 * The panel exposes:
 *   - Score tier (radio): All / Good+ / Excellent → mapped to min_score
 *   - Safe for (checkboxes): diabetes / cholesterol / hypertension / obesity
 *   - Nutri-Score (checkboxes): A / B / C / D / E
 *   - NOVA group (checkboxes): 1 / 2 / 3 / 4
 *
 * It is fully controlled: onChange fires with the next ActiveFilters
 * shape on every interaction (no internal state aside from open/close
 * for the mobile drawer).
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { FilterPanel } from '@/components/FilterPanel'
import type { ActiveFilters } from '@/components/FilterChips'

function setup(initial: ActiveFilters = {}) {
  const onChange = jest.fn()
  let value: ActiveFilters = initial
  const utils = render(
    <FilterPanel
      filters={value}
      onChange={(next) => {
        value = next
        onChange(next)
      }}
    />,
  )
  return { ...utils, onChange, current: () => value }
}

describe('FilterPanel — score tier', () => {
  it('renders three radio options', () => {
    setup()
    expect(screen.getByRole('radio', { name: /all/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /good\+/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /excellent/i })).toBeInTheDocument()
  })

  it('selecting Good+ sets min_score=60', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()
    await user.click(screen.getByRole('radio', { name: /good\+/i }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ min_score: 60 }))
  })

  it('selecting Excellent sets min_score=80', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()
    await user.click(screen.getByRole('radio', { name: /excellent/i }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ min_score: 80 }))
  })

  it('selecting All clears min_score', async () => {
    const user = userEvent.setup()
    const { onChange } = setup({ min_score: 60 })
    await user.click(screen.getByRole('radio', { name: /all/i }))
    const last = onChange.mock.calls.at(-1)?.[0] as ActiveFilters
    expect(last.min_score).toBeUndefined()
  })

  it('reflects the initial min_score in the radio selection', () => {
    setup({ min_score: 80 })
    expect(screen.getByRole('radio', { name: /excellent/i })).toBeChecked()
  })
})

describe('FilterPanel — safe_for', () => {
  it('renders the four condition checkboxes', () => {
    setup()
    for (const c of ['Diabetes', 'Cholesterol', 'Hypertension', 'Obesity']) {
      expect(screen.getByRole('checkbox', { name: new RegExp(`safe for ${c}`, 'i') }))
        .toBeInTheDocument()
    }
  })

  it('toggling a checkbox adds the value to safe_for', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()
    await user.click(screen.getByRole('checkbox', { name: /safe for diabetes/i }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ safe_for: ['diabetes'] }))
  })

  it('untoggling removes the value from safe_for', async () => {
    const user = userEvent.setup()
    const { onChange } = setup({ safe_for: ['diabetes', 'hypertension'] })
    await user.click(screen.getByRole('checkbox', { name: /safe for diabetes/i }))
    const last = onChange.mock.calls.at(-1)?.[0] as ActiveFilters
    expect(last.safe_for).toEqual(['hypertension'])
  })

  it('removing the last safe_for value drops the key', async () => {
    const user = userEvent.setup()
    const { onChange } = setup({ safe_for: ['diabetes'] })
    await user.click(screen.getByRole('checkbox', { name: /safe for diabetes/i }))
    const last = onChange.mock.calls.at(-1)?.[0] as ActiveFilters
    expect(last.safe_for).toBeUndefined()
  })
})

describe('FilterPanel — nutri_score', () => {
  it('renders A–E checkboxes', () => {
    setup()
    for (const g of ['A', 'B', 'C', 'D', 'E']) {
      expect(screen.getByRole('checkbox', { name: new RegExp(`nutri-score ${g}\\b`, 'i') }))
        .toBeInTheDocument()
    }
  })

  it('toggling adds A to nutri_score', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()
    await user.click(screen.getByRole('checkbox', { name: /nutri-score a/i }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ nutri_score: ['A'] }))
  })

  it('reflects pre-selected grades', () => {
    setup({ nutri_score: ['A', 'C'] })
    expect(screen.getByRole('checkbox', { name: /nutri-score a/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /nutri-score c/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /nutri-score b/i })).not.toBeChecked()
  })
})

describe('FilterPanel — nova_group', () => {
  it('renders 1–4 checkboxes', () => {
    setup()
    for (const g of [1, 2, 3, 4]) {
      expect(
        screen.getByRole('checkbox', { name: new RegExp(`nova ${g}\\b`, 'i') }),
      ).toBeInTheDocument()
    }
  })

  it('toggling adds 1 to nova_group as a number', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()
    await user.click(screen.getByRole('checkbox', { name: /nova 1/i }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ nova_group: [1] }))
  })
})

describe('FilterPanel — mobile drawer', () => {
  it('renders an inline sidebar by default', () => {
    setup()
    expect(screen.getByTestId('filter-panel-sidebar')).toBeInTheDocument()
  })

  it('mobile=true renders a trigger button instead of the inline panel', () => {
    const onChange = jest.fn()
    render(
      <FilterPanel filters={{}} onChange={onChange} mobile />,
    )
    expect(screen.getByRole('button', { name: /filters/i })).toBeInTheDocument()
    expect(screen.queryByTestId('filter-panel-sidebar')).not.toBeInTheDocument()
  })

  it('mobile button shows the active filter count badge', () => {
    render(
      <FilterPanel
        filters={{ min_score: 60, safe_for: ['diabetes'], nutri_score: ['A'] }}
        onChange={() => {}}
        mobile
      />,
    )
    // 1 (min_score) + 1 (diabetes) + 1 (A) = 3
    expect(screen.getByTestId('filter-count-badge')).toHaveTextContent('3')
  })
})
