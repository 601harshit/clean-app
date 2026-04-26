/**
 * AlternativeCard component tests.
 *
 * Covers the contract from docs/features/alternatives.md:
 * - Renders image, name, brand, score badge, "Order on Amazon" button.
 * - Omits the Amazon button when amazon_url is null (creds missing path).
 * - Clicking the name navigates to /food/<barcode> for the alternative.
 * - Score badge colour bands match docs/lld.md § Score Labels.
 */
import { render, screen } from '@testing-library/react'

import AlternativeCard from '@/components/AlternativeCard'
import type { Alternative } from '@/lib/api'

const base: Alternative = {
  barcode: '3760020507350',
  name: "Justin's Almond Butter",
  brand: "Justin's",
  score: 74,
  image_url: 'https://images.example.com/almonds.jpg',
  amazon_url: 'https://www.amazon.com/dp/B00FAKE?tag=clean-20',
}

describe('AlternativeCard', () => {
  it('renders name, brand, image, score, and Amazon button', () => {
    render(<AlternativeCard alternative={base} />)
    expect(screen.getByTestId('alternative-name')).toHaveTextContent(
      "Justin's Almond Butter",
    )
    expect(screen.getByTestId('alternative-brand')).toHaveTextContent(
      "Justin's",
    )
    const img = screen.getByRole('img', {
      name: /almond butter/i,
    }) as HTMLImageElement
    expect(img.src).toBe('https://images.example.com/almonds.jpg')
    expect(screen.getByTestId('alternative-score-badge')).toHaveTextContent('74')
    expect(screen.getByTestId('alternative-amazon-button')).toHaveAttribute(
      'href',
      'https://www.amazon.com/dp/B00FAKE?tag=clean-20',
    )
  })

  it('opens the Amazon link in a new tab with sponsored rel', () => {
    render(<AlternativeCard alternative={base} />)
    const btn = screen.getByTestId('alternative-amazon-button')
    expect(btn).toHaveAttribute('target', '_blank')
    expect(btn.getAttribute('rel') ?? '').toMatch(/noreferrer/)
    expect(btn.getAttribute('rel') ?? '').toMatch(/sponsored/)
  })

  it('omits the Amazon button when amazon_url is null', () => {
    render(<AlternativeCard alternative={{ ...base, amazon_url: null }} />)
    expect(
      screen.queryByTestId('alternative-amazon-button'),
    ).not.toBeInTheDocument()
    // Card itself is still rendered.
    expect(screen.getByTestId('alternative-card')).toBeInTheDocument()
    expect(screen.getByTestId('alternative-name')).toBeInTheDocument()
  })

  it('name link points to /food/<barcode>', () => {
    render(<AlternativeCard alternative={base} />)
    expect(screen.getByTestId('alternative-name')).toHaveAttribute(
      'href',
      '/food/3760020507350',
    )
  })

  it('image link also points to /food/<barcode>', () => {
    render(<AlternativeCard alternative={base} />)
    const links = screen.getAllByRole('link')
    // Both the image link and name link target the detail page.
    const detailLinks = links.filter(
      (l) => l.getAttribute('href') === '/food/3760020507350',
    )
    expect(detailLinks.length).toBeGreaterThanOrEqual(2)
  })

  it('shows a placeholder when image_url is null', () => {
    render(<AlternativeCard alternative={{ ...base, image_url: null }} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(
      screen.getByTestId('alternative-image-placeholder'),
    ).toBeInTheDocument()
  })

  it('shows "—" when brand is null', () => {
    render(<AlternativeCard alternative={{ ...base, brand: null }} />)
    expect(screen.getByTestId('alternative-brand')).toHaveTextContent('—')
  })

  it.each([
    [85, 'bg-green-600'],
    [80, 'bg-green-600'],
    [79, 'bg-lime-500'],
    [60, 'bg-lime-500'],
    [59, 'bg-yellow-400'],
    [40, 'bg-yellow-400'],
    [39, 'bg-orange-400'],
    [20, 'bg-orange-400'],
    [19, 'bg-red-500'],
    [0, 'bg-red-500'],
  ])('score %d -> %s badge color', (score, expected) => {
    render(<AlternativeCard alternative={{ ...base, score }} />)
    const badge = screen.getByTestId('alternative-score-badge')
    expect(badge).toHaveClass(expected)
  })

  it('encodes barcode safely in the URL', () => {
    render(
      <AlternativeCard
        alternative={{ ...base, barcode: 'has space/slash' }}
      />,
    )
    expect(screen.getByTestId('alternative-name').getAttribute('href')).toBe(
      `/food/${encodeURIComponent('has space/slash')}`,
    )
  })
})
