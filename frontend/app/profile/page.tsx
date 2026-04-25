/**
 * /profile — health profile editor.
 *
 * Server Component: reads the current Supabase session, calls
 * GET /api/profile with the access token, and renders ConditionPicker
 * pre-populated with the user's saved health_conditions.
 *
 * Auth: the proxy (proxy.ts) redirects unauthenticated requests to
 * /auth/login before reaching this component. Defensive null-checks
 * here are belt-and-braces in case the proxy is bypassed.
 */

import { redirect } from "next/navigation";

import ConditionPicker from "@/components/ConditionPicker";
import { getProfile } from "@/lib/api";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

async function loadProfile(): Promise<{
  email: string;
  conditions: string[];
} | null> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  try {
    const profile = await getProfile({ token: session.access_token });
    return {
      email: session.user.email ?? "",
      conditions: profile.health_conditions,
    };
  } catch {
    // Network / backend down — fall back to empty so the page still renders.
    return {
      email: session.user.email ?? "",
      conditions: [],
    };
  }
}

export default async function ProfilePage() {
  const data = await loadProfile();
  if (!data) {
    redirect("/auth/login?redirect=/profile");
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
          Your profile
        </h1>
        {data.email ? (
          <p className="text-sm text-zinc-500" data-testid="profile-email">
            {data.email}
          </p>
        ) : null}
      </header>

      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <ConditionPicker initialConditions={data.conditions} />
      </section>
    </div>
  );
}
