"use client";

import { useState, useTransition } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { updateProfile } from "@/lib/api";
import { createClient } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export const CONDITION_OPTIONS: { value: string; label: string }[] = [
  { value: "diabetes", label: "Diabetes" },
  { value: "cholesterol", label: "High Cholesterol" },
  { value: "hypertension", label: "Hypertension" },
  { value: "obesity", label: "Obesity" },
];

export type ConditionPickerProps = {
  initialConditions: string[];
  className?: string;
};

type Status = "idle" | "saving" | "saved" | "error";

/**
 * Multi-select for the four supported health conditions (FR-2).
 * Persists to the backend via PUT /api/profile on every change. The
 * supabase access token is read client-side; the server component that
 * mounts this component is itself protected by the proxy and only
 * renders for an authenticated user, so an absent token here is an
 * unexpected error path that we surface to the user.
 */
export function ConditionPicker({
  initialConditions,
  className,
}: ConditionPickerProps) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialConditions),
  );
  const [status, setStatus] = useState<Status>("idle");
  const [isPending, startTransition] = useTransition();

  async function persist(next: Set<string>) {
    setStatus("saving");
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setStatus("error");
        return;
      }
      await updateProfile(Array.from(next), { token });
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  function toggle(value: string) {
    const next = new Set(selected);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    setSelected(next);
    startTransition(() => {
      void persist(next);
    });
  }

  return (
    <fieldset
      className={cn("flex flex-col gap-3", className)}
      data-testid="condition-picker"
      aria-busy={isPending || undefined}
    >
      <legend className="text-sm font-semibold text-zinc-900">
        Health conditions
      </legend>
      <p className="text-sm text-zinc-600">
        We use these to personalize your food health scores.
      </p>
      <div className="mt-1 flex flex-col gap-2">
        {CONDITION_OPTIONS.map((opt) => {
          const checked = selected.has(opt.value);
          return (
            <label
              key={opt.value}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-900 hover:bg-zinc-50"
            >
              <Checkbox
                checked={checked}
                onCheckedChange={() => toggle(opt.value)}
                aria-label={opt.label}
                data-testid={`condition-${opt.value}`}
              />
              <span>{opt.label}</span>
            </label>
          );
        })}
      </div>
      <div
        className="min-h-[1.25rem] text-xs"
        data-testid="condition-picker-status"
        aria-live="polite"
      >
        {status === "saving" && (
          <span className="text-zinc-500">Saving…</span>
        )}
        {status === "saved" && (
          <span className="text-emerald-600">Saved</span>
        )}
        {status === "error" && (
          <span className="text-red-600">
            Could not save — please try again.
          </span>
        )}
      </div>
    </fieldset>
  );
}

export default ConditionPicker;
