"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { clearHistory } from "@/lib/api";
import { createClient } from "@/lib/supabase";

export type ClearHistoryButtonProps = {
  /**
   * Server-rendered access token. We try the browser-side supabase
   * client first (in case the token has been refreshed mid-session) and
   * fall back to this prop.
   */
  initialToken?: string;
};

/**
 * Client island for FR-7.3: clearing scan history.
 *
 * Two-click confirm so an accidental click doesn't wipe state. After a
 * successful DELETE we router.refresh() so the server component re-runs
 * and the page renders the empty state.
 */
export function ClearHistoryButton({
  initialToken,
}: ClearHistoryButtonProps = {}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function doClear() {
    setError(null);
    try {
      let token = initialToken;
      try {
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.access_token) {
          token = session.access_token;
        }
      } catch {
        // Browser client unavailable — fall through to initialToken.
      }
      if (!token) {
        setError("Sign in required");
        return;
      }
      await clearHistory({ token });
      setConfirming(false);
      router.refresh();
    } catch {
      setError("Failed to clear");
    }
  }

  if (!confirming) {
    return (
      <Button
        variant="outline"
        onClick={() => setConfirming(true)}
        data-testid="clear-history-button"
      >
        Clear history
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button
          variant="destructive"
          onClick={() =>
            startTransition(() => {
              void doClear();
            })
          }
          disabled={isPending}
          data-testid="clear-history-confirm"
        >
          {isPending ? "Clearing…" : "Yes, clear"}
        </Button>
      </div>
      {error ? (
        <span className="text-xs text-red-600" data-testid="clear-history-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export default ClearHistoryButton;
