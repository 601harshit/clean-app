/**
 * AlternativeCard — one healthier alternative shown on /food/[barcode].
 *
 * Behaviours per docs/features/alternatives.md:
 * - Shows product image (or placeholder), name, brand, score badge with
 *   the same colour bands as ProductCard / docs/lld.md § Score Labels.
 * - Clicking the name or image navigates to /food/<barcode> for that
 *   alternative (Next <Link>).
 * - "Order on Amazon" anchor opens in a new tab with rel="noreferrer
 *   sponsored". Omitted entirely when amazon_url is null (the API returns
 *   null when the PA API is unconfigured or returned no result), so the
 *   card still renders cleanly without a buy button.
 */

import Link from "next/link"
import { ImageOffIcon, ShoppingCartIcon } from "lucide-react"

import type { Alternative } from "@/lib/api"
import { cn } from "@/lib/utils"

// Same bands as ProductCard. Source of truth: docs/lld.md § Score Labels.
function scoreColor(score: number): string {
  if (score >= 80) return "bg-green-600 text-white"
  if (score >= 60) return "bg-lime-500 text-white"
  if (score >= 40) return "bg-yellow-400 text-zinc-900"
  if (score >= 20) return "bg-orange-400 text-white"
  return "bg-red-500 text-white"
}

export type AlternativeCardProps = {
  alternative: Alternative
  className?: string
}

export function AlternativeCard({ alternative, className }: AlternativeCardProps) {
  const { barcode, name, brand, image_url, score, amazon_url } = alternative
  const detailHref = `/food/${encodeURIComponent(barcode)}`

  return (
    <article
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white",
        className,
      )}
      data-testid="alternative-card"
    >
      <Link
        href={detailHref}
        className="group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
        aria-label={`View ${name} details`}
      >
        <div className="relative aspect-square w-full bg-zinc-100">
          {image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image_url}
              alt={name}
              loading="lazy"
              className="h-full w-full object-contain transition-transform group-hover:scale-105"
            />
          ) : (
            <div
              data-testid="alternative-image-placeholder"
              className="flex h-full w-full items-center justify-center text-zinc-400"
              aria-hidden="true"
            >
              <ImageOffIcon className="size-10" />
            </div>
          )}
          <span
            data-testid="alternative-score-badge"
            className={cn(
              "absolute top-2 left-2 inline-flex h-9 min-w-9 items-center justify-center rounded-full px-2 text-sm font-semibold tabular-nums shadow-sm",
              scoreColor(score),
            )}
            aria-label={`Health score ${score} out of 100`}
          >
            {score}
          </span>
        </div>
      </Link>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <Link
          href={detailHref}
          className="text-sm font-medium leading-snug text-zinc-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
          data-testid="alternative-name"
        >
          {name}
        </Link>
        <p
          data-testid="alternative-brand"
          className="text-xs text-zinc-500"
        >
          {brand ?? "—"}
        </p>
        {amazon_url ? (
          <a
            href={amazon_url}
            target="_blank"
            rel="noreferrer sponsored"
            data-testid="alternative-amazon-button"
            className="mt-auto inline-flex items-center justify-center gap-2 rounded-md bg-amber-500 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700"
          >
            <ShoppingCartIcon className="size-4" aria-hidden="true" />
            Order on Amazon
          </a>
        ) : null}
      </div>
    </article>
  )
}

export default AlternativeCard
