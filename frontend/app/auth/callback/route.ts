import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase-server";

/**
 * OAuth + email-confirm callback.
 *
 * Supabase redirects the browser back to /auth/callback?code=<one-time-code>
 * after the user authenticates with Google (or clicks the email confirmation
 * link). We exchange the code for a session and store it in cookies via
 * @supabase/ssr, then redirect onward.
 *
 * `next` query param lets the originating link request a specific landing
 * page (e.g. /profile after email confirm). Defaults to /.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  // Resolve the destination relative to the current origin so we never
  // open-redirect to an external host.
  const safeNext = next.startsWith("/") ? next : "/";
  const destination = new URL(safeNext, url.origin);

  if (!code) {
    // No code -> nothing to do. Bounce to login with a hint so the user knows.
    const loginUrl = new URL("/auth/login", url.origin);
    loginUrl.searchParams.set("error", "missing_code");
    return NextResponse.redirect(loginUrl);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("auth callback: code exchange failed", error);
    const loginUrl = new URL("/auth/login", url.origin);
    loginUrl.searchParams.set("error", "exchange_failed");
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.redirect(destination);
}
