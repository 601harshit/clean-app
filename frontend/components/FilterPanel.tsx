"use client"

import { useState } from "react"
import { SlidersHorizontalIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import type { ActiveFilters } from "@/components/FilterChips"
import { cn } from "@/lib/utils"

const SAFE_FOR_OPTIONS: { value: string; label: string }[] = [
  { value: "diabetes", label: "Safe for Diabetes" },
  { value: "cholesterol", label: "Safe for Cholesterol" },
  { value: "hypertension", label: "Safe for Hypertension" },
  { value: "obesity", label: "Safe for Obesity" },
]

const NUTRI_GRADES = ["A", "B", "C", "D", "E"] as const
const NOVA_GROUPS = [1, 2, 3, 4] as const

const NOVA_LABELS: Record<number, string> = {
  1: "Unprocessed",
  2: "Processed ingredients",
  3: "Processed",
  4: "Ultra-processed",
}

type ScoreTier = "all" | "good" | "excellent"

function tierFromMinScore(min?: number): ScoreTier {
  if (min === undefined) return "all"
  if (min >= 80) return "excellent"
  if (min >= 60) return "good"
  return "all"
}

function activeFilterCount(f: ActiveFilters): number {
  let n = 0
  if (f.min_score !== undefined) n += 1
  n += f.safe_for?.length ?? 0
  n += f.nutri_score?.length ?? 0
  n += f.nova_group?.length ?? 0
  return n
}

function toggleArr<T>(arr: T[] | undefined, value: T): T[] | undefined {
  const list = arr ?? []
  const next = list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value]
  return next.length === 0 ? undefined : next
}

type PanelBodyProps = {
  filters: ActiveFilters
  onChange: (next: ActiveFilters) => void
}

function PanelBody({ filters, onChange }: PanelBodyProps) {
  const tier = tierFromMinScore(filters.min_score)

  function setTier(next: ScoreTier) {
    const copy = { ...filters }
    if (next === "all") {
      delete copy.min_score
    } else {
      copy.min_score = next === "excellent" ? 80 : 60
    }
    onChange(copy)
  }

  function toggleSafeFor(v: string) {
    const next = toggleArr(filters.safe_for, v)
    const copy = { ...filters }
    if (next) copy.safe_for = next
    else delete copy.safe_for
    onChange(copy)
  }

  function toggleGrade(g: string) {
    const next = toggleArr(filters.nutri_score, g)
    const copy = { ...filters }
    if (next) copy.nutri_score = next
    else delete copy.nutri_score
    onChange(copy)
  }

  function toggleNova(n: number) {
    const next = toggleArr(filters.nova_group, n)
    const copy = { ...filters }
    if (next) copy.nova_group = next
    else delete copy.nova_group
    onChange(copy)
  }

  return (
    <div className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold text-zinc-900">Score</legend>
        <RadioGroup
          value={tier}
          onValueChange={(v) => setTier(v as ScoreTier)}
          aria-label="Score tier"
        >
          {[
            { value: "all", label: "All" },
            { value: "good", label: "Good+ (≥60)" },
            { value: "excellent", label: "Excellent (≥80)" },
          ].map((o) => (
            <label
              key={o.value}
              className="flex cursor-pointer items-center gap-2 text-sm text-zinc-800"
            >
              <RadioGroupItem value={o.value} aria-label={o.label} />
              <span>{o.label}</span>
            </label>
          ))}
        </RadioGroup>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold text-zinc-900">
          Condition safety
        </legend>
        {SAFE_FOR_OPTIONS.map((o) => (
          <label
            key={o.value}
            className="flex cursor-pointer items-center gap-2 text-sm text-zinc-800"
          >
            <Checkbox
              checked={filters.safe_for?.includes(o.value) ?? false}
              onCheckedChange={() => toggleSafeFor(o.value)}
              aria-label={o.label}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold text-zinc-900">
          Nutri-Score
        </legend>
        <div className="flex flex-wrap gap-2">
          {NUTRI_GRADES.map((g) => (
            <label
              key={g}
              className="flex cursor-pointer items-center gap-2 text-sm text-zinc-800"
            >
              <Checkbox
                checked={filters.nutri_score?.includes(g) ?? false}
                onCheckedChange={() => toggleGrade(g)}
                aria-label={`Nutri-Score ${g}`}
              />
              <span>{g}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold text-zinc-900">
          NOVA group
        </legend>
        {NOVA_GROUPS.map((n) => (
          <label
            key={n}
            className="flex cursor-pointer items-center gap-2 text-sm text-zinc-800"
          >
            <Checkbox
              checked={filters.nova_group?.includes(n) ?? false}
              onCheckedChange={() => toggleNova(n)}
              aria-label={`NOVA ${n} ${NOVA_LABELS[n]}`}
            />
            <span>
              {n}{" "}
              <span className="text-zinc-500">({NOVA_LABELS[n]})</span>
            </span>
          </label>
        ))}
      </fieldset>
    </div>
  )
}

export type FilterPanelProps = {
  filters: ActiveFilters
  onChange: (next: ActiveFilters) => void
  /**
   * When true, render a "Filters" trigger button + Sheet drawer (mobile).
   * When false (default), render the inline sidebar (md+ desktop).
   */
  mobile?: boolean
  className?: string
}

export function FilterPanel({
  filters,
  onChange,
  mobile = false,
  className,
}: FilterPanelProps) {
  const [open, setOpen] = useState(false)
  const count = activeFilterCount(filters)

  if (mobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          render={
            <Button
              variant="outline"
              className="h-10 rounded-full px-4"
              aria-label="Filters"
            />
          }
        >
          <SlidersHorizontalIcon aria-hidden="true" />
          <span>Filters</span>
          {count > 0 && (
            <Badge
              data-testid="filter-count-badge"
              variant="default"
              className="ml-1"
            >
              {count}
            </Badge>
          )}
        </SheetTrigger>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">
            <PanelBody filters={filters} onChange={onChange} />
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <aside
      data-testid="filter-panel-sidebar"
      className={cn(
        "flex w-full flex-col gap-6 rounded-xl border border-zinc-200 bg-white p-5",
        className,
      )}
    >
      <h2 className="text-base font-semibold text-zinc-900">Filters</h2>
      <PanelBody filters={filters} onChange={onChange} />
    </aside>
  )
}

export default FilterPanel
