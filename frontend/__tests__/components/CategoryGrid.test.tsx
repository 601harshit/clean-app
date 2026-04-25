/**
 * CategoryGrid component tests (TDD).
 *
 * Renders a horizontal scrollable row of category chips. Each chip is a Link
 * to /search?category=<slug>. The list is hardcoded per
 * docs/features/food-search.md §API > Categories — no fetch on mount,
 * since the canonical curated list lives in the spec.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { CATEGORIES, CategoryGrid } from '@/components/CategoryGrid'

describe('CategoryGrid', () => {
  it('renders the 8 hardcoded categories from the spec', () => {
    render(<CategoryGrid />)
    const expected = [
      'Snacks', 'Dairy', 'Beverages', 'Cereals',
      'Condiments', 'Frozen', 'Breads', 'Meats',
    ]
    for (const label of expected) {
      expect(screen.getByRole('link', { name: new RegExp(label, 'i') })).toBeInTheDocument()
    }
  })

  it('exports CATEGORIES as the canonical list', () => {
    expect(CATEGORIES).toHaveLength(8)
    expect(CATEGORIES[0]).toEqual({ slug: 'snacks', label: 'Snacks', icon: '🍿' })
    for (const c of CATEGORIES) {
      expect(c).toHaveProperty('slug')
      expect(c).toHaveProperty('label')
      expect(c).toHaveProperty('icon')
    }
  })

  it('each chip links to /search?category=<slug>', () => {
    render(<CategoryGrid />)
    const link = screen.getByRole('link', { name: /snacks/i })
    expect(link).toHaveAttribute('href', '/search?category=snacks')
  })

  it('renders each category icon for visual recognition', () => {
    render(<CategoryGrid />)
    expect(screen.getByText('🍿')).toBeInTheDocument()
    expect(screen.getByText('🥛')).toBeInTheDocument()
  })

  it('uses a horizontally scrollable container (overflow-x-auto)', () => {
    const { container } = render(<CategoryGrid />)
    const scroller = container.querySelector('[data-slot="category-scroller"]')
    expect(scroller).toHaveClass('overflow-x-auto')
  })

  it('marks the active category chip via aria-current', () => {
    render(<CategoryGrid activeSlug="dairy" />)
    const dairy = screen.getByRole('link', { name: /dairy/i })
    expect(dairy).toHaveAttribute('aria-current', 'page')
    const snacks = screen.getByRole('link', { name: /snacks/i })
    expect(snacks).not.toHaveAttribute('aria-current')
  })

  it('chips are keyboard focusable', async () => {
    const user = userEvent.setup()
    render(<CategoryGrid />)
    await user.tab()
    expect(screen.getByRole('link', { name: /snacks/i })).toHaveFocus()
  })
})
