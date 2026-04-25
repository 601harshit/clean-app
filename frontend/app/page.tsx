import Link from "next/link"
import { ScanLine } from "lucide-react"

import { CategoryGrid } from "@/components/CategoryGrid"
import { SearchBar } from "@/components/SearchBar"

/**
 * Home page (T1.2): SearchBar at the top, hero copy, then CategoryGrid.
 * Search submits to /search?q=...; category chips deep-link to
 * /search?category=<slug>. The full search/browse/filter UX lives on /search.
 */
export default function Home() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-12 px-6 pt-16 pb-24">
      <section className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-5xl font-semibold tracking-tight text-zinc-900">
          Clean.
        </h1>
        <p className="text-lg text-zinc-600">Know what you eat.</p>
      </section>

      <section>
        <div className="flex w-full items-center gap-2">
          <div className="flex-1">
            <SearchBar />
          </div>
          <Link
            href="/scan"
            aria-label="Scan barcode"
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
          >
            <ScanLine aria-hidden="true" className="size-4" />
            <span className="sr-only md:not-sr-only">Scan barcode</span>
          </Link>
        </div>
        <p className="mt-3 text-center text-xs text-zinc-500">
          Try{" "}
          <Link href="/search?q=nutella" className="underline">
            Nutella
          </Link>
          ,{" "}
          <Link href="/search?q=oats" className="underline">
            oats
          </Link>
          , or{" "}
          <Link href="/search?q=greek+yogurt" className="underline">
            Greek yogurt
          </Link>
          .
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Browse categories
        </h2>
        <CategoryGrid />
      </section>
    </div>
  )
}
