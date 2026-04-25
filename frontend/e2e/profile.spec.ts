/**
 * Profile + History E2E — runs against the LOCAL Supabase + FastAPI
 * stack (no mocks). Skipped in CI (PLAYWRIGHT_SKIP_AUTH=1) because
 * neither service is available there.
 *
 * Acceptance criteria covered:
 *   FR-2.1 Sign up → set conditions → backend persists them
 *   FR-2.3 Reload page → conditions still selected (cross-session)
 *   FR-7.1 Visiting a food detail page (authed) records scan_history
 *   FR-7.2 /history shows the recent scan with correct fields
 *   FR-7.3 Clear history empties the page
 */

import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
// Local Supabase service-role key (well-known, demo). Used only to clean up
// users so the spec is repeatable. NOT a secret.
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const PASSWORD = "correct-horse-battery";

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function uniqueEmail(label: string): string {
  const slug = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `e2e-${slug}@example.com`;
}

async function deleteUserByEmail(email: string): Promise<void> {
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
  await expect(page).toHaveURL(/\/profile$/);
}

test.describe("profile editor (FR-2)", () => {
  let email: string;

  test.beforeEach(() => {
    email = uniqueEmail("profile");
  });

  test.afterEach(async () => {
    await deleteUserByEmail(email);
  });

  test("set conditions, refresh, and they persist", async ({ page }) => {
    await signUp(page, email);

    // ConditionPicker should render with all four checkboxes unchecked.
    const diabetes = page.getByRole("checkbox", { name: /^diabetes/i });
    const cholesterol = page.getByRole("checkbox", {
      name: /^high cholesterol/i,
    });
    const hypertension = page.getByRole("checkbox", { name: /^hypertension/i });
    const obesity = page.getByRole("checkbox", { name: /^obesity/i });
    await expect(diabetes).not.toBeChecked();
    await expect(cholesterol).not.toBeChecked();
    await expect(hypertension).not.toBeChecked();
    await expect(obesity).not.toBeChecked();

    // Toggle two on, wait for save status.
    await diabetes.click();
    await expect(page.getByTestId("condition-picker-status")).toHaveText(
      /saved/i,
    );

    await hypertension.click();
    await expect(page.getByTestId("condition-picker-status")).toHaveText(
      /saved/i,
    );

    // Reload — selections should persist (FR-2.2/2.3).
    await page.reload();
    await expect(
      page.getByRole("checkbox", { name: /^diabetes/i }),
    ).toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: /^hypertension/i }),
    ).toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: /^obesity/i }),
    ).not.toBeChecked();
  });
});

test.describe("history page (FR-7)", () => {
  let email: string;

  test.beforeEach(() => {
    email = uniqueEmail("history");
  });

  test.afterEach(async () => {
    await deleteUserByEmail(email);
  });

  test("empty → view food → history shows it → clear empties", async ({
    page,
  }) => {
    await signUp(page, email);

    // /history is initially empty.
    await page.goto("/history");
    await expect(page.getByTestId("history-empty")).toBeVisible();

    // Visit a known product detail page; backend must record scan_history.
    // We use Open Food Facts' real Nutella barcode — the backend resolves
    // it via cache or the live API.
    await page.goto("/food/3017620422003");
    await expect(
      page.getByRole("heading", { level: 1 }),
    ).toBeVisible({ timeout: 15_000 });

    // Now /history should list one item.
    await page.goto("/history");
    const items = page.getByTestId("history-item");
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText(/nutella/i);
    await expect(page.getByTestId("history-score").first()).toBeVisible();

    // Clear history (two-click confirm).
    await page.getByTestId("clear-history-button").click();
    await page.getByTestId("clear-history-confirm").click();
    await expect(page.getByTestId("history-empty")).toBeVisible();
  });
});
