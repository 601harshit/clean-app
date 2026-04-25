/**
 * BodyImpactSummary — placeholder for the AI-generated body impact text.
 *
 * Per the task split, T1.4 wires up the Claude-backed body_impact field.
 * Until then this component renders the prop string if present, or
 * nothing if null/empty — so we never break the page when LLM is offline.
 */

import * as React from 'react';

export type BodyImpactSummaryProps = {
  text: string | null;
};

export default function BodyImpactSummary({ text }: BodyImpactSummaryProps) {
  if (!text) return null;
  return (
    <section
      className="rounded-xl border border-zinc-200 bg-zinc-50 p-4"
      data-testid="body-impact-summary"
      aria-label="Body impact summary"
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        What this does to your body
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-zinc-800">{text}</p>
    </section>
  );
}
