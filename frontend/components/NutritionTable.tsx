/**
 * NutritionTable — per-100g nutrient rows.
 *
 * Rows that triggered a penalty are highlighted in red. We derive the
 * "penalty" label from the same threshold table the backend uses (kept in
 * sync via docs/lld.md § Scoring Algorithm) so a row turns red iff the
 * scoring service would penalize it for at least one condition.
 */

import * as React from 'react';
import type { Nutrient } from '@/lib/api';

export type NutritionTableProps = {
  nutrients: Nutrient;
};

type Row = {
  key: keyof Nutrient;
  label: string;
  unit: string;
  /** Threshold above which this row is highlighted as a penalty trigger. */
  penaltyAt: number | null;
  format?: (v: number) => string;
};

const ROWS: Row[] = [
  { key: 'energy_kcal', label: 'Calories', unit: 'kcal', penaltyAt: 400 },
  { key: 'fat', label: 'Total fat', unit: 'g', penaltyAt: 20 },
  { key: 'saturated_fat', label: 'Saturated fat', unit: 'g', penaltyAt: 5 },
  { key: 'carbohydrates', label: 'Carbohydrates', unit: 'g', penaltyAt: 40 },
  { key: 'sugars', label: 'Sugars', unit: 'g', penaltyAt: 15 },
  { key: 'fiber', label: 'Fiber', unit: 'g', penaltyAt: null },
  { key: 'proteins', label: 'Protein', unit: 'g', penaltyAt: null },
  { key: 'sodium', label: 'Sodium', unit: 'g', penaltyAt: 0.3 },
];

function fmt(v: number, unit: string): string {
  if (unit === 'kcal') return Math.round(v).toString();
  if (Number.isInteger(v)) return v.toString();
  return v.toFixed(2).replace(/\.?0+$/, '');
}

export default function NutritionTable({ nutrients }: NutritionTableProps) {
  return (
    <section
      className="rounded-xl border border-zinc-200 bg-white"
      data-testid="nutrition-table"
      aria-label="Nutrition facts per 100g"
    >
      <header className="border-b border-zinc-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-900">Nutrition (per 100g)</h2>
      </header>
      <table className="w-full text-sm">
        <tbody>
          {ROWS.map((row) => {
            const value = nutrients[row.key];
            const isPenalty = row.penaltyAt !== null && value > row.penaltyAt;
            return (
              <tr
                key={row.key}
                data-testid={`nutrient-${row.key}`}
                data-penalty={isPenalty || undefined}
                className={
                  isPenalty
                    ? 'bg-red-50 text-red-900'
                    : 'border-t border-zinc-100 first:border-t-0'
                }
              >
                <th
                  scope="row"
                  className="px-4 py-2 text-left font-normal"
                >
                  {row.label}
                </th>
                <td className="px-4 py-2 text-right tabular-nums">
                  {fmt(value, row.unit)} {row.unit}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
