/**
 * ScoreRing — circular 0-100 SVG meter with color band per docs/lld.md.
 *
 * Color: score >= 60 ? green : score >= 40 ? yellow : red
 *
 * Pure server-renderable component (no state, no effects). Animation is
 * intentionally CSS-only via stroke-dashoffset transition so the component
 * stays a Server Component.
 */

import * as React from 'react';

export type ScoreRingProps = {
  score: number;
  /** Optional one-word label shown below the number (e.g. "Excellent"). */
  label?: string;
  /** Outer pixel size of the SVG. Defaults to 192 (matches detail page). */
  size?: number;
  /** Stroke width. Defaults to 14. */
  strokeWidth?: number;
};

function colorFor(score: number): string {
  if (score >= 60) return '#16a34a'; // green-600
  if (score >= 40) return '#eab308'; // yellow-500
  return '#dc2626'; // red-600
}

export default function ScoreRing({
  score,
  label,
  size = 192,
  strokeWidth = 14,
}: ScoreRingProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const color = colorFor(clamped);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  return (
    <div
      className="inline-flex flex-col items-center"
      data-testid="score-ring"
      role="img"
      aria-label={`Health score ${clamped} out of 100${label ? `, ${label}` : ''}`}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#e5e7eb"
          strokeWidth={strokeWidth}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 600ms ease-out' }}
        />
      </svg>
      <div
        className="-mt-[60%] flex flex-col items-center pointer-events-none"
        style={{ color }}
      >
        <span className="text-5xl font-semibold leading-none" data-testid="score-value">
          {clamped}
        </span>
        {label ? (
          <span className="mt-1 text-sm font-medium uppercase tracking-wide">
            {label}
          </span>
        ) : null}
      </div>
    </div>
  );
}
