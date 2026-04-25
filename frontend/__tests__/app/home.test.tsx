/**
 * Home page (app/page.tsx) test.
 *
 * The home page is a server component but renders a client SearchBar +
 * a server CategoryGrid. RTL renders this as a regular component since
 * Next-jest tests don't actually distinguish server/client rendering.
 */
import { render, screen } from '@testing-library/react'

import Home from '@/app/page'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

describe('Home', () => {
  it('renders the brand heading', () => {
    render(<Home />)
    expect(screen.getByRole('heading', { name: /Clean\./i })).toBeVisible()
  })

  it('renders the SearchBar', () => {
    render(<Home />)
    expect(screen.getByRole('search')).toBeVisible()
    expect(screen.getByRole('searchbox')).toBeVisible()
  })

  it('renders the CategoryGrid with all 8 categories', () => {
    render(<Home />)
    for (const label of [
      'Snacks', 'Dairy', 'Beverages', 'Cereals',
      'Condiments', 'Frozen', 'Breads', 'Meats',
    ]) {
      expect(
        screen.getByRole('link', { name: new RegExp(label, 'i') }),
      ).toBeInTheDocument()
    }
  })

  it('renders example query links pointing into /search', () => {
    render(<Home />)
    expect(screen.getByRole('link', { name: /nutella/i }))
      .toHaveAttribute('href', '/search?q=nutella')
    expect(screen.getByRole('link', { name: /^oats$/i }))
      .toHaveAttribute('href', '/search?q=oats')
    expect(screen.getByRole('link', { name: /greek yogurt/i }))
      .toHaveAttribute('href', '/search?q=greek+yogurt')
  })
})
