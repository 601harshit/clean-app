/**
 * /history — recent scans (FR-7).
 *
 * Server component: fetches the user's last 20 scan_history rows via
 * GET /api/history with their access token. The proxy enforces auth
 * before this page renders, so an absent session is a defensive edge.
 *
 * Each row links back to /food/[barcode] for re-viewing. A small client
 * island lets the user clear their history (FR-7.3).
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { ClearHistoryButton } from "@/components/ClearHistoryButton";
import { getHistory, type HistoryItem } from "@/lib/api";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const SCORE_COLORS: { [bucket: string]: string } = {
  excellent: "bg-green-600 text-white",
  good: "bg-lime-500 text-white",
  fair: "bg-yellow-400 text-zinc-900",
  poor: "bg-orange-400 text-white",
  avoid: "bg-red-500 text-white",
};

function bucketForScore(score: number): keyof typeof SCORE_COLORS {
  if (score >= 80) return "excellent";
  if (score >= 60) return "good";
  if (score >= 40) return "fair";
  if (score >= 20) return "poor";
  return "avoid";
}

function formatScannedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

async function loadHistory(): Promise<HistoryItem[] | null> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  try {
    return await getHistory({ token: session.access_token });
  } catch {
    return [];
  }
}

export default async function HistoryPage() {
  const items = await loadHistory();
  if (items === null) {
    redirect("/auth/login?redirect=/history");
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
            History
          </h1>
          <p className="text-sm text-zinc-500">
            Your most recent {items.length === 0 ? "" : items.length} scans.
          </p>
        </div>
        {items.length > 0 ? <ClearHistoryButton /> : null}
      </header>

      {items.length === 0 ? (
        <p
          className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-8 text-center text-sm text-zinc-500"
          data-testid="history-empty"
        >
          You haven&apos;t scanned anything yet. Look up a food to get started.
        </p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="history-list">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={item.barcode ? `/food/${encodeURIComponent(item.barcode)}` : "#"}
                className="flex items-center gap-4 rounded-xl border border-zinc-200 bg-white p-3 transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
                data-testid="history-item"
              >
                <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-zinc-100">
                  {item.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.image_url}
                      alt={item.product_name}
                      loading="lazy"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <div
                      aria-hidden="true"
                      className="flex h-full w-full items-center justify-center text-xs text-zinc-400"
                    >
                      No image
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className="truncate text-sm font-medium text-zinc-900"
                    title={item.product_name}
                  >
                    {item.product_name}
                  </p>
                  {item.brand ? (
                    <p className="truncate text-xs text-zinc-500">{item.brand}</p>
                  ) : null}
                  <p
                    className="mt-1 text-xs text-zinc-400"
                    data-testid="history-scanned-at"
                  >
                    {formatScannedAt(item.scanned_at)}
                  </p>
                </div>
                <span
                  data-testid="history-score"
                  aria-label={`Score ${item.score} out of 100`}
                  className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums shadow-sm ${SCORE_COLORS[bucketForScore(item.score)]}`}
                >
                  {item.score}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
