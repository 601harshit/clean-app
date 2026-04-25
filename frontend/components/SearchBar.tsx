"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { SearchIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export type SearchBarProps = {
  defaultValue?: string
  /**
   * Optional debounced callback for the home-page typeahead UX.
   * Not used on the /search results page (per spec, search executes on submit).
   */
  onDebouncedChange?: (value: string) => void
  debounceMs?: number
  className?: string
}

export function SearchBar({
  defaultValue = "",
  onDebouncedChange,
  debounceMs = 400,
  className,
}: SearchBarProps) {
  const router = useRouter()
  const [value, setValue] = useState(defaultValue)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!onDebouncedChange) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onDebouncedChange(value)
    }, debounceMs)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [value, onDebouncedChange, debounceMs])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) return
    const params = new URLSearchParams({ q: trimmed })
    router.push(`/search?${params.toString()}`)
  }

  return (
    <form
      role="search"
      onSubmit={handleSubmit}
      className={`flex w-full items-center gap-2 ${className ?? ""}`}
    >
      <div className="relative flex-1">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          inputMode="search"
          aria-label="Search foods"
          placeholder="Search foods, brands, or barcodes"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-11 rounded-full pl-9 pr-3 text-base"
        />
      </div>
      <Button
        type="submit"
        aria-label="Search"
        className="h-11 rounded-full px-4"
      >
        <SearchIcon aria-hidden="true" />
        <span className="sr-only md:not-sr-only">Search</span>
      </Button>
    </form>
  )
}

export default SearchBar
