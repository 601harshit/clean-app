import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase-server";

/**
 * Sign-out endpoint.
 *
 * Called via a small POST form (so we can mutate cookies server-side without
 * shipping the supabase client to every layout). Clears the Supabase auth
 * cookies and redirects to /, satisfying acceptance #6.
 *
 * GET is intentionally NOT supported because a stray GET (e.g. a prefetch)
 * could log the user out unexpectedly.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  // Don't fail loudly if there is no session — the desired end state is
  // "user signed out", which is already true.
  await supabase.auth.signOut();
  const homeUrl = new URL("/", request.url);
  return NextResponse.redirect(homeUrl, { status: 303 });
}
