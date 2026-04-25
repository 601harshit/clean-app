import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/profile", "/history"];

/**
 * Proxy (formerly middleware in Next.js <16) — runs before every protected route.
 *
 * Responsibilities:
 *   1. Refresh the Supabase auth cookie on every request (so SSR pages always
 *      see a fresh session).
 *   2. Redirect unauthenticated users away from /profile and /history to /auth/login.
 *
 * IMPORTANT: We use `getUser()` (not `getSession()`) because `getSession()` only
 * reads the cookie and is unsafe for authorization decisions per @supabase/ssr docs.
 */
export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some((prefix) => path.startsWith(prefix));
  if (isProtected && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/auth/login";
    loginUrl.searchParams.set("redirect", path);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/profile/:path*", "/history/:path*"],
};
