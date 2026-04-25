/**
 * BodyImpactSummary placeholder tests.
 */

import { render, screen } from '@testing-library/react'
import BodyImpactSummary from '@/components/BodyImpactSummary'

describe('BodyImpactSummary', () => {
  it('renders nothing when text is null', () => {
    const { container } = render(<BodyImpactSummary text={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when text is empty string', () => {
    const { container } = render(<BodyImpactSummary text="" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the text when provided', () => {
    render(<BodyImpactSummary text="Nutella spikes blood sugar fast." />)
    expect(
      screen.getByText('Nutella spikes blood sugar fast.'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('body-impact-summary')).toBeInTheDocument()
  })
})
