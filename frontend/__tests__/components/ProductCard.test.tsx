/**
 * ProductCard component tests (TDD).
 *
 * Card used in search results. Shows: image (or placeholder), name, brand,
 * a coloured score badge (0–100), and a Nutri-Score grade pill (A–E,
 * coloured per spec). Whole card links to /food/<barcode>.
 */
import { render, screen } from '@testing-library/react'

import { ProductCard } from '@/components/ProductCard'
import type { ProductSummary } from '@/lib/api'

const base: ProductSummary = {
  barcode: '3017620422003',
  name: 'Nutella',
  brand: 'Ferrero',
  image_url: 'https://images.openfoodfacts.org/nutella.jpg',
  nutri_score: 'E',
  nova_group: 4,
  score: 12,
}

describe('ProductCard', () => {
  it('renders name, brand, image, score and nutri-score', () => {
    render(<ProductCard product={base} />)
    expect(screen.getByText('Nutella')).toBeInTheDocument()
    expect(screen.getByText('Ferrero')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument() // score
    expect(screen.getByText('E')).toBeInTheDocument() // nutri-score
    const img = screen.getByRole('img', { name: /nutella/i }) as HTMLImageElement
    expect(img.src).toBe('https://images.openfoodfacts.org/nutella.jpg')
  })

  it('whole card is a link to /food/<barcode>', () => {
    render(<ProductCard product={base} />)
    const link = screen.getByRole('link', { name: /nutella/i })
    expect(link).toHaveAttribute('href', '/food/3017620422003')
  })

  it.each([
    ['A', 'bg-green-600'],
    ['B', 'bg-lime-500'],
    ['C', 'bg-yellow-400'],
    ['D', 'bg-orange-400'],
    ['E', 'bg-red-500'],
  ])('uses %s -> %s for the nutri-score badge color', (grade, klass) => {
    render(<ProductCard product={{ ...base, nutri_score: grade }} />)
    const badge = screen.getByTestId('nutri-score-badge')
    expect(badge).toHaveClass(klass)
  })

  it('shows a placeholder when image_url is null', () => {
    render(<ProductCard product={{ ...base, image_url: null }} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByTestId('product-image-placeholder')).toBeInTheDocument()
  })

  it('shows "—" when brand is null', () => {
    render(<ProductCard product={{ ...base, brand: null }} />)
    expect(screen.getByTestId('product-brand')).toHaveTextContent('—')
  })

  it('omits the nutri-score badge when grade is null', () => {
    render(<ProductCard product={{ ...base, nutri_score: null }} />)
    expect(screen.queryByTestId('nutri-score-badge')).not.toBeInTheDocument()
  })

  it('clamps the score visually for out-of-band values without crashing', () => {
    // defensive: backend returns 0–100, but render shouldn't blow up if not
    render(<ProductCard product={{ ...base, score: 150 }} />)
    expect(screen.getByText('150')).toBeInTheDocument()
  })

  it('long product names are not truncated in the DOM (CSS handles overflow)', () => {
    const long = 'X'.repeat(120)
    render(<ProductCard product={{ ...base, name: long }} />)
    expect(screen.getByText(long)).toBeInTheDocument()
  })
})
