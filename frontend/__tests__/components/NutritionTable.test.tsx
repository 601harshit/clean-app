/**
 * NutritionTable tests — row rendering, penalty highlighting.
 */

import { render, screen } from '@testing-library/react'
import NutritionTable from '@/components/NutritionTable'
import type { Nutrient } from '@/lib/api'

const NUTELLA: Nutrient = {
  energy_kcal: 539,
  fat: 30.9,
  saturated_fat: 10.6,
  carbohydrates: 57.5,
  sugars: 56.3,
  fiber: 0,
  proteins: 6.3,
  sodium: 0.107,
}

const SAFE: Nutrient = {
  energy_kcal: 100,
  fat: 1,
  saturated_fat: 1,
  carbohydrates: 5,
  sugars: 1,
  fiber: 5,
  proteins: 12,
  sodium: 0.05,
}

describe('NutritionTable', () => {
  it('renders all eight nutrient rows', () => {
    render(<NutritionTable nutrients={NUTELLA} />)
    for (const k of [
      'energy_kcal',
      'fat',
      'saturated_fat',
      'carbohydrates',
      'sugars',
      'fiber',
      'proteins',
      'sodium',
    ] as const) {
      expect(screen.getByTestId(`nutrient-${k}`)).toBeInTheDocument()
    }
  })

  it('shows the value with units', () => {
    render(<NutritionTable nutrients={NUTELLA} />)
    expect(screen.getByTestId('nutrient-sugars')).toHaveTextContent('56.3 g')
    expect(screen.getByTestId('nutrient-energy_kcal')).toHaveTextContent(
      '539 kcal',
    )
  })

  it('highlights rows above the penalty threshold', () => {
    render(<NutritionTable nutrients={NUTELLA} />)
    expect(screen.getByTestId('nutrient-sugars')).toHaveAttribute(
      'data-penalty',
      'true',
    )
    expect(screen.getByTestId('nutrient-saturated_fat')).toHaveAttribute(
      'data-penalty',
      'true',
    )
    // Sodium 0.107 < 0.3 → not highlighted
    expect(screen.getByTestId('nutrient-sodium')).not.toHaveAttribute(
      'data-penalty',
    )
  })

  it('does NOT highlight any row for a safe product', () => {
    render(<NutritionTable nutrients={SAFE} />)
    for (const k of [
      'energy_kcal',
      'fat',
      'saturated_fat',
      'carbohydrates',
      'sugars',
      'sodium',
    ] as const) {
      expect(screen.getByTestId(`nutrient-${k}`)).not.toHaveAttribute(
        'data-penalty',
      )
    }
  })

  it('does not highlight fiber or protein (no thresholds)', () => {
    const huge: Nutrient = { ...SAFE, fiber: 99, proteins: 99 }
    render(<NutritionTable nutrients={huge} />)
    expect(screen.getByTestId('nutrient-fiber')).not.toHaveAttribute(
      'data-penalty',
    )
    expect(screen.getByTestId('nutrient-proteins')).not.toHaveAttribute(
      'data-penalty',
    )
  })
})
