"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { CategoryGrid } from "@/components/CategoryGrid"
import {
  FilterChips,
  type ActiveFilters,
  type RemovedFilter,
} from "@/components/FilterChips"
import { FilterPanel } from "@/components/FilterPanel"
import { ProductCard } from "@/components/ProductCard"
import { SearchBar } from "@/components/SearchBar"
import { Button } from "@/components/ui/button"
import { searchFoods, type ProductSummary, type SearchResponse } from "@/lib/api"

type ParsedParams = ActiveFilters & {
  q?: string
  page: number
}

function parseParams(sp: URLSearchParams): ParsedParams {
  const out: ParsedParams = { page: 1 }
  const q = sp.get("q")
  if (q) out.q = q
  const cat = sp.get("category")
  if (cat) out.category = cat
  const min = sp.get("min_score")
  if (min !== null && min !== "") out.min_score = Number(min)
  const safe_for = sp.getAll("safe_for")
  if (safe_for.length > 0) out.safe_for = safe_for
  const ns = sp.getAll("nutri_score")
  if (ns.length > 0) out.nutri_score = ns
  const nova = sp.getAll("nova_group").map((v) => Number(v))
  if (nova.length > 0) out.nova_group = nova
  const page = sp.get("page")
  if (page) out.page = Math.max(1, Number(page))
  return out
}

function toQueryString(params: ParsedParams): string {
  const sp = new URLSearchParams()
  if (params.q) sp.set("q", params.q)
  if (params.category) sp.set("category", params.category)
  if (params.min_score !== undefined)
    sp.set("min_score", String(params.min_score))
  for (const v of params.safe_for ?? []) sp.append("safe_for", v)
  for (const v of params.nutri_score ?? []) sp.append("nutri_score", v)
  for (const v of params.nova_group ?? []) sp.append("nova_group", String(v))
  if (params.page > 1) sp.set("page", String(params.page))
  return sp.toString()
}

const PAGE_SIZE = 20

export default function SearchPageClient() {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  // useSearchParams returns ReadonlyURLSearchParams; treat as URLSearchParams-like.
  // Memoize on the serialized string so a re-rendered hook reference doesn't
  // make `parsed` change identity and re-trigger the fetch effect.
  const spStr = sp.toString()
  const parsed = useMemo<ParsedParams>(
    () => parseParams(new URLSearchParams(spStr)),
    [spStr],
  )

  const [products, setProducts] = useState<ProductSummary[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasQuery = !!parsed.q || !!parsed.category

  useEffect(() => {
    if (!hasQuery) {
      setProducts([])
      setTotal(0)
      setError(null)
      return
    }
    const ctrl = new AbortController()
    setLoading(true)
    setError(null)
    const { page, q, category, min_score, safe_for, nutri_score, nova_group } =
      parsed
    searchFoods(
      {
        q,
        category,
        page,
        min_score,
        safe_for,
        nutri_score,
        nova_group,
      },
      { signal: ctrl.signal },
    )
      .then((res: SearchResponse) => {
        setTotal(res.total)
        // For page>1 append; for page==1 replace
        setProducts((prev) =>
          page === 1 ? res.products : [...prev, ...res.products],
        )
      })
      .catch((e) => {
        if (e?.name === "AbortError") return
        setError("Something went wrong. Please try again.")
        setProducts([])
        setTotal(0)
      })
      .finally(() => setLoading(false))
    return () => ctrl.abort()
  }, [hasQuery, parsed])

  const navigate = useCallback(
    (next: ParsedParams) => {
      const qs = toQueryString(next)
      router.push(qs ? `${pathname}?${qs}` : pathname)
    },
    [router, pathname],
  )

  const onFiltersChange = useCallback(
    (next: ActiveFilters) => {
      navigate({ ...parsed, ...next, page: 1 })
    },
    [parsed, navigate],
  )

  const onRemoveChip = useCallback(
    (f: RemovedFilter) => {
      const copy: ParsedParams = { ...parsed, page: 1 }
      switch (f.key) {
        case "category":
          delete copy.category
          break
        case "min_score":
          delete copy.min_score
          break
        case "safe_for": {
          const next = (copy.safe_for ?? []).filter((v) => v !== f.value)
          if (next.length === 0) delete copy.safe_for
          else copy.safe_for = next
          break
        }
        case "nutri_score": {
          const next = (copy.nutri_score ?? []).filter((v) => v !== f.value)
          if (next.length === 0) delete copy.nutri_score
          else copy.nutri_score = next
          break
        }
        case "nova_group": {
          const next = (copy.nova_group ?? []).filter((v) => v !== f.value)
          if (next.length === 0) delete copy.nova_group
          else copy.nova_group = next
          break
        }
      }
      navigate(copy)
    },
    [parsed, navigate],
  )

  const onClearAll = useCallback(() => {
    const cleared: ParsedParams = { page: 1 }
    if (parsed.q) cleared.q = parsed.q
    navigate(cleared)
  }, [parsed, navigate])

  const onLoadMore = useCallback(() => {
    navigate({ ...parsed, page: parsed.page + 1 })
  }, [parsed, navigate])

  // For FilterPanel/FilterChips we strip q + page (those are not "filters")
  const filtersForPanel: ActiveFilters = useMemo(() => {
    const a: ActiveFilters = {}
    if (parsed.category) a.category = parsed.category
    if (parsed.min_score !== undefined) a.min_score = parsed.min_score
    if (parsed.safe_for) a.safe_for = parsed.safe_for
    if (parsed.nutri_score) a.nutri_score = parsed.nutri_score
    if (parsed.nova_group) a.nova_group = parsed.nova_group
    return a
  }, [parsed])

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
      <SearchBar defaultValue={parsed.q} />

      {parsed.category && <CategoryGrid activeSlug={parsed.category} />}

      <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
        <div className="hidden md:block md:w-72 md:shrink-0">
          <FilterPanel
            filters={filtersForPanel}
            onChange={onFiltersChange}
          />
        </div>

        <div className="flex flex-1 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-zinc-600">
              {hasQuery && !loading && !error
                ? `${total} products`
                : ""}
            </p>
            <div className="md:hidden">
              <FilterPanel
                filters={filtersForPanel}
                onChange={onFiltersChange}
                mobile
              />
            </div>
          </div>

          <FilterChips
            filters={filtersForPanel}
            onRemove={onRemoveChip}
            onClearAll={onClearAll}
          />

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
            >
              Something went wrong. Please try again.
            </div>
          )}

          {!hasQuery && !error && (
            <div className="rounded-xl border border-dashed border-zinc-200 p-10 text-center text-sm text-zinc-500">
              Start by searching or pick a category.
            </div>
          )}

          {hasQuery && loading && products.length === 0 && (
            <div
              data-testid="results-skeleton"
              className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
              aria-busy="true"
              aria-label="Loading results"
            >
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="aspect-square animate-pulse rounded-xl bg-zinc-100"
                />
              ))}
            </div>
          )}

          {hasQuery && !loading && !error && products.length === 0 && (
            <div className="rounded-xl border border-dashed border-zinc-200 p-10 text-center">
              <p className="text-base font-medium text-zinc-900">
                No results found
              </p>
              <p className="mt-1 text-sm text-zinc-500">
                Try a different search term or remove some filters.
              </p>
            </div>
          )}

          {products.length > 0 && (
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {products.map((p) => (
                <li key={p.barcode}>
                  <ProductCard product={p} />
                </li>
              ))}
            </ul>
          )}

          {hasQuery &&
            !error &&
            products.length > 0 &&
            products.length < total && (
              <div className="flex justify-center pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 rounded-full px-6"
                  onClick={onLoadMore}
                  disabled={loading}
                >
                  {loading ? "Loading..." : "Load more"}
                </Button>
              </div>
            )}
        </div>
      </div>
    </div>
  )
}
