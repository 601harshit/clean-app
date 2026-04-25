import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

/**
 * Auth E2E — runs against the LOCAL Supabase instance (no mocks).
 *
 * Acceptance criteria covered (see docs/features/auth.md):
 *   #1 Login page renders email+password form and Google OAuth button
 *   #2 Email signup → redirects to /profile
 *   #4 Invalid credentials → inline error
 *   #5 Session survives page refresh
 *   #6 Sign out clears session, redirects to /
 *   #7 /profile and /history redirect unauthed users to /auth/login
 *   #8 profiles row auto-creates on first signup (verified via service role)
 *
 * #3 (Google OAuth → /) is partially covered: we verify the button exists
 * and triggers an OAuth redirect; we do NOT click through Google's UI in CI
 * because that would require real OAuth provider credentials.
 */

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
// Local Supabase service-role key (well-known, demo). Used only to clean up
// created users so this spec is repeatable. NOT a secret.
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

function uniqueEmail(label: string): string {
  // Random per-test email so parallel + repeat runs don't collide.
  const slug = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `e2e-${slug}@example.com`;
}

const PASSWORD = "correct-horse-battery";

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function deleteUserByEmail(email: string): Promise<void> {
  // Page through users to find the email — the local instance is small so 1
  // page is plenty.
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error || !data?.users) return;
  const match = data.users.find((u) => u.email === email);
  if (match) {
    await admin.auth.admin.deleteUser(match.id);
  }
}

async function signUp(page: Page, email: string): Promise<void> {
  await page.goto("/auth/login");
  await page.getByRole("button", { name: /create an account/i }).click();
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();
}

test.describe("login page render (acceptance #1)", () => {
  test("shows email + password fields and Google button", async ({ page }) => {
    await page.goto("/auth/login");

    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /sign in$/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /continue with google/i }),
    ).toBeVisible();
  });
});

test.describe("protected routes (acceptance #7)", () => {
  test("/profile redirects unauthed → /auth/login?redirect=/profile", async ({
    page,
  }) => {
    await page.goto("/profile");
    await expect(page).toHaveURL(/\/auth\/login\?redirect=%2Fprofile/);
  });

  test("/history redirects unauthed → /auth/login?redirect=/history", async ({
    page,
  }) => {
    await page.goto("/history");
    await expect(page).toHaveURL(/\/auth\/login\?redirect=%2Fhistory/);
  });
});

test.describe("sign in (sad path — acceptance #4)", () => {
  test("invalid credentials show inline error and stay on login", async ({
    page,
  }) => {
    await page.goto("/auth/login");
    await page.getByLabel(/email/i).fill("nope-nobody@example.com");
    await page.getByLabel(/password/i).fill("totally-wrong-pw");
    await page.getByRole("button", { name: /sign in$/i }).click();

    await expect(page.locator("#auth-error")).toHaveText(
      /invalid email or password/i,
    );
    await expect(page).toHaveURL(/\/auth\/login/);
  });
});

test.describe("sign up → profile → refresh → sign out", () => {
  let email: string;

  test.beforeEach(async () => {
    email = uniqueEmail("happy");
  });

  test.afterEach(async () => {
    await deleteUserByEmail(email);
  });

  test("happy path covers acceptance #2, #5, #6, #8", async ({ page }) => {
    // Acceptance #2: signup redirects to /profile (which 404s for now —
    // the proxy must NOT redirect a signed-in user back to /auth/login).
    await signUp(page, email);
    await expect(page).toHaveURL(/\/profile$/);

    // Nav now shows the email + Sign out (acceptance "user indicator").
    await expect(page.getByTestId("nav-user-email")).toContainText(email);
    await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible();

    // Acceptance #5: session survives page refresh.
    await page.reload();
    await expect(page.getByTestId("nav-user-email")).toContainText(email);
    await expect(page).toHaveURL(/\/profile$/);

    // Acceptance #8: profiles row auto-created by the on_auth_user_created
    // trigger. Use the service role to read it (RLS would otherwise allow
    // only the owner).
    const {
      data: { users },
    } = await admin.auth.admin.listUsers({ perPage: 200 });
    const user = users.find((u) => u.email === email);
    expect(user).toBeDefined();
    const { data: profile, error: profileErr } = await admin
      .from("profiles")
      .select("id, health_conditions")
      .eq("id", user!.id)
      .single();
    expect(profileErr).toBeNull();
    expect(profile?.id).toBe(user!.id);
    expect(profile?.health_conditions).toEqual([]);

    // Acceptance #6: sign out clears session and lands on /.
    await page.getByRole("button", { name: /sign out/i }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();
    await expect(page.getByTestId("nav-user-email")).toHaveCount(0);

    // After sign-out, /profile should redirect again (re-confirms #7).
    await page.goto("/profile");
    await expect(page).toHaveURL(/\/auth\/login/);
  });
});

test.describe("sign in existing user", () => {
  let email: string;

  test.beforeEach(async () => {
    email = uniqueEmail("existing");
    // Pre-create the user via the admin API so we exercise sign-in (not sign-up).
    await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
  });

  test.afterEach(async () => {
    await deleteUserByEmail(email);
  });

  test("sign in lands on / by default and respects ?redirect=", async ({
    page,
  }) => {
    // Default: land on /.
    await page.goto("/auth/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.getByRole("button", { name: /sign in$/i }).click();
    await expect(page).toHaveURL("/");

    // Sign back out, then verify ?redirect=/history is honored.
    await page.getByRole("button", { name: /sign out/i }).click();
    await expect(page).toHaveURL("/");

    await page.goto("/history");
    await expect(page).toHaveURL(/\/auth\/login\?redirect=%2Fhistory/);
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.getByRole("button", { name: /sign in$/i }).click();
    await expect(page).toHaveURL(/\/history$/);
  });
});

test.describe("Google OAuth button (acceptance #3, partial)", () => {
  test("clicking 'Continue with Google' triggers an OAuth redirect", async ({
    page,
  }) => {
    // We don't have Google OAuth configured in local Supabase, so the
    // request will fail — but we DO verify the button calls the provider
    // endpoint, which is the part we own.
    await page.goto("/auth/login");

    const oauthRequest = page.waitForRequest(
      (req) =>
        req.url().includes("/auth/v1/authorize") &&
        req.url().includes("provider=google"),
    );
    await page.getByRole("button", { name: /continue with google/i }).click();
    const req = await oauthRequest;
    expect(req.url()).toContain("provider=google");
    expect(req.url()).toContain("redirect_to=");
    expect(req.url()).toContain("auth%2Fcallback");
  });
});

test.describe("client-side validation (edge)", () => {
  test("malformed email shows inline error before hitting Supabase", async ({
    page,
  }) => {
    await page.goto("/auth/login");
    // Bypass the browser's built-in email validity by using JS to set the
    // value, then submit the form directly so our validator runs.
    await page.getByLabel(/email/i).evaluate((el: HTMLInputElement) => {
      el.value = "not-an-email";
    });
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.evaluate(() => {
      const form = document.querySelector("form")!;
      form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    });

    await expect(page.locator("#auth-error")).toHaveText(
      /please enter a valid email/i,
    );
  });
});
