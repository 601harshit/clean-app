import Link from "next/link"
import { ImageOffIcon } from "lucide-react"

import type { ProductSummary } from "@/lib/api"
import { cn } from "@/lib/utils"

const NUTRI_SCORE_COLORS: Record<string, string> = {
  A: "bg-green-600 text-white",
  B: "bg-lime-500 text-white",
  C: "bg-yellow-400 text-zinc-900",
  D: "bg-orange-400 text-white",
  E: "bg-red-500 text-white",
}

function scoreColor(score: number): string {
  if (score >= 80) return "bg-green-600 text-white"
  if (score >= 60) return "bg-lime-500 text-white"
  if (score >= 40) return "bg-yellow-400 text-zinc-900"
  if (score >= 20) return "bg-orange-400 text-white"
  return "bg-red-500 text-white"
}

export type ProductCardProps = {
  product: ProductSummary
  className?: string
}

export function ProductCard({ product, className }: ProductCardProps) {
  const { barcode, name, brand, image_url, nutri_score, score } = product
  const nutriClass =
    nutri_score && NUTRI_SCORE_COLORS[nutri_score.toUpperCase()]
      ? NUTRI_SCORE_COLORS[nutri_score.toUpperCase()]
      : "bg-zinc-300 text-zinc-900"

  return (
    <Link
      href={`/food/${encodeURIComponent(barcode)}`}
      className={cn(
        "group flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900",
        className,
      )}
      data-testid="product-card"
    >
      <div className="relative aspect-square w-full bg-zinc-100">
        {image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image_url}
            alt={name}
            loading="lazy"
            className="h-full w-full object-contain"
          />
        ) : (
          <div
            data-testid="product-image-placeholder"
            className="flex h-full w-full items-center justify-center text-zinc-400"
            aria-hidden="true"
          >
            <ImageOffIcon className="size-10" />
          </div>
        )}
        <span
          data-testid="score-badge"
          className={cn(
            "absolute top-2 left-2 inline-flex h-9 min-w-9 items-center justify-center rounded-full px-2 text-sm font-semibold tabular-nums shadow-sm",
            scoreColor(score),
          )}
          aria-label={`Health score ${score} out of 100`}
        >
          {score}
        </span>
        {nutri_score && (
          <span
            data-testid="nutri-score-badge"
            className={cn(
              "absolute top-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-sm font-bold uppercase shadow-sm",
              nutriClass,
            )}
            aria-label={`Nutri-Score ${nutri_score}`}
          >
            {nutri_score}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1 p-3">
        <h3
          className="text-sm font-medium leading-snug text-zinc-900"
          title={name}
        >
          {name}
        </h3>
        <p data-testid="product-brand" className="text-xs text-zinc-500">
          {brand ?? "—"}
        </p>
      </div>
    </Link>
  )
}

export default ProductCard
