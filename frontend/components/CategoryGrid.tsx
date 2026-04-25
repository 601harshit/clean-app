import Link from "next/link"

import { cn } from "@/lib/utils"

export type Category = {
  slug: string
  label: string
  icon: string
}

/**
 * Curated top-level categories — mirrors backend's GET /api/food/categories
 * shape (see docs/features/food-search.md §API > Categories). We hardcode it
 * client-side so the home page renders without a fetch round-trip; the
 * backend endpoint remains the single source of truth and the values must
 * stay in sync with it.
 */
export const CATEGORIES: readonly Category[] = [
  { slug: "snacks", label: "Snacks", icon: "🍿" },
  { slug: "dairy", label: "Dairy", icon: "🥛" },
  { slug: "beverages", label: "Beverages", icon: "🧃" },
  { slug: "cereals", label: "Cereals", icon: "🥣" },
  { slug: "condiments", label: "Condiments", icon: "🧴" },
  { slug: "frozen", label: "Frozen", icon: "🧊" },
  { slug: "breads", label: "Breads", icon: "🍞" },
  { slug: "meats", label: "Meats", icon: "🥩" },
] as const

export type CategoryGridProps = {
  activeSlug?: string
  className?: string
}

export function CategoryGrid({ activeSlug, className }: CategoryGridProps) {
  return (
    <nav
      aria-label="Browse by category"
      className={cn("w-full", className)}
    >
      <ul
        data-slot="category-scroller"
        className="flex w-full gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]"
      >
        {CATEGORIES.map((c) => {
          const isActive = c.slug === activeSlug
          return (
            <li key={c.slug} className="shrink-0">
              <Link
                href={`/search?category=${c.slug}`}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex min-w-[6rem] flex-col items-center gap-1 rounded-2xl border px-4 py-3 text-sm font-medium transition-colors",
                  isActive
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50",
                )}
              >
                <span aria-hidden="true" className="text-2xl">
                  {c.icon}
                </span>
                <span>{c.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export default CategoryGrid
