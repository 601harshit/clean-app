import { Suspense } from "react"

import SearchPageClient from "./SearchPageClient"

function SearchPageFallback() {
  return (
    <div
      data-testid="results-skeleton"
      className="mx-auto max-w-6xl px-4 py-6"
      aria-busy="true"
    >
      <div className="h-11 w-full animate-pulse rounded-full bg-zinc-100" />
    </div>
  )
}

/**
 * /search — full search/browse/filter results page.
 * Wraps the client component in Suspense per Next 16 useSearchParams contract.
 */
export default function SearchPage() {
  return (
    <Suspense fallback={<SearchPageFallback />}>
      <SearchPageClient />
    </Suspense>
  )
}
