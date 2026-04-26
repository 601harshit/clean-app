/**
 * /food/[barcode] — product detail page.
 *
 * Server Component: fetches via lib/api.getFoodByBarcode(), then composes
 * ScoreRing + ScoreBreakdown + NutritionTable + BodyImpactSummary.
 *
 * Auth: if a Supabase session is present, we forward its access token to
 * the backend so it returns a personalized score. Guests get a generic
 * score with a "Sign in for personalized score" banner.
 *
 * Errors: a 404 / unknown barcode degrades to notFound() — Next renders
 * the standard 404 page rather than crashing.
 */

import { notFound } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { getFoodByBarcode, type FoodResult } from '@/lib/api';
import { createClient } from '@/lib/supabase-server';
import ScoreRing from '@/components/ScoreRing';
import ScoreBreakdown from '@/components/ScoreBreakdown';
import NutritionTable from '@/components/NutritionTable';
import BodyImpactSummary from '@/components/BodyImpactSummary';
import AlternativeCard from '@/components/AlternativeCard';

export const dynamic = 'force-dynamic'; // session-dependent, never prerender

type PageProps = {
  params: Promise<{ barcode: string }>;
};

const NUTRI_BADGE_COLORS: Record<string, string> = {
  A: 'bg-green-600',
  B: 'bg-lime-500',
  C: 'bg-yellow-400 text-zinc-900',
  D: 'bg-orange-400',
  E: 'bg-red-500',
};

const NOVA_LABELS: Record<number, string> = {
  1: 'Unprocessed',
  2: 'Processed ingredients',
  3: 'Processed',
  4: 'Ultra-processed',
};

const NUTRI_EXPLANATION =
  'Nutri-Score grades nutritional quality from A (best) to E (worst) using fat, sugar, salt, fiber, protein.';

async function getToken(): Promise<string | undefined> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token;
  } catch {
    return undefined;
  }
}

async function fetchProduct(
  barcode: string,
): Promise<{ result: FoodResult; signedIn: boolean } | null> {
  const token = await getToken();
  try {
    const result = await getFoodByBarcode(barcode, { token });
    return { result, signedIn: Boolean(token) };
  } catch {
    return null;
  }
}

export default async function FoodDetailPage({ params }: PageProps) {
  const { barcode } = await params;
  const fetched = await fetchProduct(barcode);
  if (!fetched) {
    notFound();
  }
  const { result: f, signedIn } = fetched;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12" data-testid="food-detail-page">
      <header className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        {f.image_url ? (
          // Use next/image so production gets optimization, but keep
          // unoptimized=true since OFF images are remote and we don't
          // configure a domain whitelist for this MVP.
          <Image
            src={f.image_url}
            alt={f.name}
            width={120}
            height={120}
            unoptimized
            className="h-30 w-30 rounded-lg border border-zinc-200 object-contain"
          />
        ) : (
          <div className="h-30 w-30 rounded-lg border border-dashed border-zinc-300 bg-zinc-50" />
        )}
        <div className="flex-1 text-center sm:text-left">
          <h1 className="text-2xl font-semibold text-zinc-900">{f.name}</h1>
          {f.brand ? (
            <p className="mt-1 text-sm text-zinc-600">{f.brand}</p>
          ) : null}
          <p className="mt-1 text-xs font-mono text-zinc-400">{f.barcode}</p>
        </div>
      </header>

      <section
        className="mt-8 flex flex-col items-center"
        data-testid="score-section"
      >
        <ScoreRing score={f.score} label={f.score_label} />
        {f.personalized ? (
          <p
            className="mt-3 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700"
            data-testid="personalized-banner"
          >
            Personalized for your conditions
          </p>
        ) : signedIn ? null : (
          <p
            className="mt-3 text-xs text-zinc-500"
            data-testid="signin-banner"
          >
            <Link href="/auth/login" className="underline hover:text-zinc-900">
              Sign in
            </Link>{' '}
            for a score personalized to your health profile.
          </p>
        )}
      </section>

      <BodyImpactSummary text={f.body_impact} />

      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-zinc-200 p-3" data-testid="nutri-card">
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Nutri-Score
          </div>
          <div className="mt-2 flex items-center gap-3">
            <span
              className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white ${
                f.nutri_score
                  ? NUTRI_BADGE_COLORS[f.nutri_score] ?? 'bg-zinc-400'
                  : 'bg-zinc-300 text-zinc-700'
              }`}
            >
              {f.nutri_score ?? '?'}
            </span>
            <span className="text-xs text-zinc-600">{NUTRI_EXPLANATION}</span>
          </div>
        </div>
        <div className="rounded-xl border border-zinc-200 p-3" data-testid="nova-card">
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            NOVA
          </div>
          <div className="mt-2 flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900 text-sm font-bold text-white">
              {f.nova_group ?? '?'}
            </span>
            <span className="text-xs text-zinc-600">
              {f.nova_group ? NOVA_LABELS[f.nova_group] : 'Unknown processing level'}
            </span>
          </div>
        </div>
      </section>

      <div className="mt-6">
        <ScoreBreakdown factors={f.score_breakdown} />
      </div>

      <div className="mt-6">
        <NutritionTable nutrients={f.nutrients} />
      </div>

      <section
        className="mt-8"
        data-testid="alternatives-section"
        aria-labelledby="alternatives-heading"
      >
        <h2
          id="alternatives-heading"
          className="text-sm font-semibold uppercase tracking-wide text-zinc-500"
        >
          Healthier alternatives
        </h2>
        {f.alternatives.length === 0 ? (
          <p
            className="mt-3 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4 text-center text-sm text-zinc-500"
            data-testid="alternatives-empty"
          >
            No healthier alternatives found for this product.
          </p>
        ) : (
          <ul
            className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3"
            data-testid="alternatives-list"
          >
            {f.alternatives.map((alt) => (
              <li key={alt.barcode}>
                <AlternativeCard alternative={alt} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
