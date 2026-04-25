/**
 * ScoreBreakdown — collapsible list of ScoreFactor entries.
 *
 * Collapsed by default on mobile (per docs/features/scoring.md). Sorts
 * factors by absolute impact descending so the biggest contributors are
 * surfaced first.
 *
 * Client component because it owns local open/closed state. The page
 * passes server-fetched data in.
 */

'use client';

import * as React from 'react';
import type { ScoreFactor } from '@/lib/api';

export type ScoreBreakdownProps = {
  factors: ScoreFactor[];
  /** Force open (defaults to false: collapsed). Useful for desktop. */
  defaultOpen?: boolean;
};

function impactClass(impact: number): string {
  if (impact > 0) return 'text-green-700 bg-green-50';
  if (impact < 0) return 'text-red-700 bg-red-50';
  return 'text-zinc-600 bg-zinc-100';
}

function impactLabel(impact: number): string {
  if (impact > 0) return `+${impact}`;
  return String(impact);
}

export default function ScoreBreakdown({
  factors,
  defaultOpen = false,
}: ScoreBreakdownProps) {
  const [open, setOpen] = React.useState(defaultOpen);

  const sorted = React.useMemo(
    () => [...factors].sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)),
    [factors],
  );

  return (
    <section
      className="rounded-xl border border-zinc-200 bg-white"
      data-testid="score-breakdown"
    >
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        aria-expanded={open}
        aria-controls="score-breakdown-list"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-sm font-semibold text-zinc-900">Score breakdown</span>
        <span className="text-xs text-zinc-500">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open ? (
        <ul
          id="score-breakdown-list"
          className="divide-y divide-zinc-100 border-t border-zinc-100"
        >
          {sorted.length === 0 ? (
            <li className="px-4 py-3 text-sm text-zinc-500">
              No factors contributed to this score.
            </li>
          ) : (
            sorted.map((f, i) => (
              <li
                key={`${f.factor}-${i}`}
                className="flex items-start justify-between gap-3 px-4 py-3"
                data-testid="score-factor"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-zinc-900">{f.factor}</p>
                  <p className="mt-0.5 text-xs text-zinc-600">{f.reason}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${impactClass(
                    f.impact,
                  )}`}
                >
                  {impactLabel(f.impact)}
                </span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </section>
  );
}
