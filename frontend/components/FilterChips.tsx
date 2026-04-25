"use client"

import { XIcon } from "lucide-react"

import { CATEGORIES } from "@/components/CategoryGrid"
import { cn } from "@/lib/utils"

export type ActiveFilters = {
  category?: string
  min_score?: number
  safe_for?: string[]
  nutri_score?: string[]
  nova_group?: number[]
}

export type RemovedFilter =
  | { key: "category" }
  | { key: "min_score" }
  | { key: "safe_for"; value: string }
  | { key: "nutri_score"; value: string }
  | { key: "nova_group"; value: number }

const SAFE_FOR_LABELS: Record<string, string> = {
  diabetes: "Safe for Diabetes",
  cholesterol: "Safe for Cholesterol",
  hypertension: "Safe for Hypertension",
  obesity: "Safe for Obesity",
}

const NUTRI_SCORE_COLORS: Record<string, string> = {
  A: "bg-green-600 text-white",
  B: "bg-lime-500 text-white",
  C: "bg-yellow-400 text-zinc-900",
  D: "bg-orange-400 text-white",
  E: "bg-red-500 text-white",
}

function categoryLabel(slug: string): string {
  return CATEGORIES.find((c) => c.slug === slug)?.label ?? slug
}

function minScoreLabel(min: number): string {
  if (min >= 80) return "Excellent (≥80)"
  if (min >= 60) return "Good+ (≥60)"
  return `Score ≥${min}`
}

type Chip = {
  testId: string
  label: string
  className?: string
  removed: RemovedFilter
}

function buildChips(filters: ActiveFilters): Chip[] {
  const chips: Chip[] = []
  if (filters.category) {
    chips.push({
      testId: `chip-category`,
      label: categoryLabel(filters.category),
      removed: { key: "category" },
    })
  }
  if (filters.min_score !== undefined) {
    chips.push({
      testId: `chip-min_score`,
      label: minScoreLabel(filters.min_score),
      removed: { key: "min_score" },
    })
  }
  for (const v of filters.safe_for ?? []) {
    chips.push({
      testId: `chip-safe_for-${v}`,
      label: SAFE_FOR_LABELS[v] ?? `Safe for ${v}`,
      removed: { key: "safe_for", value: v },
    })
  }
  for (const v of filters.nutri_score ?? []) {
    chips.push({
      testId: `chip-nutri_score-${v}`,
      label: `Nutri-Score ${v}`,
      className: NUTRI_SCORE_COLORS[v.toUpperCase()],
      removed: { key: "nutri_score", value: v },
    })
  }
  for (const v of filters.nova_group ?? []) {
    chips.push({
      testId: `chip-nova_group-${v}`,
      label: `NOVA ${v}`,
      removed: { key: "nova_group", value: v },
    })
  }
  return chips
}

export type FilterChipsProps = {
  filters: ActiveFilters
  onRemove: (f: RemovedFilter) => void
  onClearAll: () => void
  className?: string
}

export function FilterChips({
  filters,
  onRemove,
  onClearAll,
  className,
}: FilterChipsProps) {
  const chips = buildChips(filters)
  if (chips.length === 0) return null

  return (
    <div
      data-slot="filter-chips"
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      {chips.map((chip) => (
        <span
          key={chip.testId}
          data-testid={chip.testId}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 py-1 pl-3 pr-1 text-xs font-medium text-zinc-700",
            chip.className,
          )}
        >
          {chip.label}
          <button
            type="button"
            aria-label={`Remove ${chip.label}`}
            onClick={() => onRemove(chip.removed)}
            className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
          >
            <XIcon className="size-3" aria-hidden="true" />
          </button>
        </span>
      ))}
      {chips.length > 1 && (
        <button
          type="button"
          onClick={onClearAll}
          className="ml-1 text-xs font-medium text-zinc-600 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
        >
          Clear all
        </button>
      )}
    </div>
  )
}

export default FilterChips
