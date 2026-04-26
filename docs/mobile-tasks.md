# Clean. — Mobile (Android) Task Breakdown

Phase 2 of the project plan: a React Native (Expo) mobile app that targets Android first. Reuses the existing FastAPI backend on Railway and the same Supabase project — **zero backend changes**.

> **Stack lock**
> Expo SDK 52+ (managed) · TypeScript · Expo Router (file-based) · NativeWind (Tailwind for RN) · Supabase JS SDK + `expo-auth-session` · `expo-camera` (built-in barcode scanner) · Jest + `@testing-library/react-native` · Maestro for E2E · EAS Build + Play Store internal track.

> **Workflow** — same rules as Phase 1: branch from `main`, write failing tests first, multiple smaller commits per logical change, push, open PR, CI must be green, no auto-merge. Use `.worktrees/<branch-name>` to avoid collision when multiple agents work in parallel.

---

## Phase M0 — Mobile foundation (sequential)

These must merge before any feature work. One agent owns Phase M0 to avoid collisions on shared scaffolding.

### M0.1 — Project scaffold
- **Files**:
  - `mobile/` directory at repo root
  - `mobile/package.json` (Expo SDK 52, TS, Expo Router, NativeWind)
  - `mobile/app.json` (slug `clean`, `ios.bundleIdentifier`/`android.package` = `app.getclean.clean`)
  - `mobile/tsconfig.json` (extends `expo/tsconfig.base`)
  - `mobile/app/_layout.tsx` (root Expo Router layout)
  - `mobile/app/index.tsx` (placeholder home)
  - `mobile/global.css` (Tailwind base; processed by NativeWind)
  - `mobile/babel.config.js`, `mobile/metro.config.js` (NativeWind setup)
  - `mobile/.gitignore`, `mobile/CLAUDE.md`, `mobile/AGENTS.md`
  - `mobile/.env.example` — `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- **DoD**:
  - [ ] `cd mobile && npm install && npx expo start` boots Metro
  - [ ] `npx expo run:android` (or Expo Go on a physical device) renders the placeholder
  - [ ] Tailwind classes apply (NativeWind verified on a button)
  - [ ] `tsc --noEmit` clean

### M0.2 — Shared API client + types
- **Spec**: `docs/lld.md` § API Contracts (must match `frontend/lib/api.ts` field-for-field)
- **Files**:
  - `mobile/lib/api.ts` — copy of `frontend/lib/api.ts` (typed fetchers + types)
  - `mobile/lib/api.contract.test.ts` — runtime check that the parsed response matches the TS types via a small sample fixture (catches divergence)
  - `scripts/sync-types.sh` — one-shot script that diffs `mobile/lib/api.ts` against `frontend/lib/api.ts` and fails CI if they drift
- **DoD**:
  - [ ] Types compile; functions are stubs that throw `NotImplemented` if no body yet
  - [ ] `sync-types` script wired into the mobile-lint CI job

### M0.3 — Auth setup (Supabase + Expo)
- **Spec**: `docs/features/auth.md` (mobile equivalent — same Supabase project, same flows)
- **Files**:
  - `mobile/lib/supabase.ts` — Supabase client with `AsyncStorage` adapter and `detectSessionInUrl: false`
  - `mobile/lib/auth.tsx` — React context exposing `session`, `signInWithPassword`, `signUp`, `signInWithGoogle`, `signOut`
  - `mobile/app.json` — register URL scheme `clean://` for OAuth deep-linking
- **DoD**:
  - [ ] Sign-up/sign-in/sign-out work end-to-end against local Supabase via the Expo dev client
  - [ ] Sessions persist across app restarts
  - [ ] Google OAuth deep-link round-trip (uses `expo-auth-session` + Supabase's mobile flow)

### M0.4 — Theme + shared UI primitives
- **Files**:
  - `mobile/components/ui/Button.tsx`, `Input.tsx`, `Badge.tsx`, `Card.tsx` (NativeWind, mirror shadcn/ui shapes)
  - `mobile/components/ui/ScoreBadge.tsx` (reused across screens)
  - `mobile/lib/colors.ts` (Nutri-Score and score-band palette — same as web)
  - `mobile/tailwind.config.js` — same theme tokens as `frontend/tailwind.config.js`
- **DoD**:
  - [ ] Each component has an RTL test
  - [ ] Visual parity with web on phone viewport (manual check)

### M0.5 — Test infrastructure
- **Files**:
  - `mobile/jest.config.ts` (preset `jest-expo`, jsdom-like for RN)
  - `mobile/jest.setup.ts` (`@testing-library/jest-native`, mocks for `expo-modules-core`, `expo-camera`, `expo-router`)
  - `mobile/__tests__/` skeleton + a sanity test
  - `mobile/.maestro/smoke.yaml` — Maestro smoke flow: launch app → see "Clean." brand → tap nav
  - `scripts/test-mobile.sh` — runs `npm test` + `maestro test` against a connected emulator
- **DoD**:
  - [ ] `cd mobile && npm test` passes (≥ 1 test)
  - [ ] Maestro smoke runs on Android emulator; documented prereq: Android Studio + AVD or `flutter doctor`-equivalent

### M0.6 — CI for mobile (lint + unit + build)
- **Files**: `.github/workflows/mobile-ci.yml`
- **Jobs**:
  - `mobile-lint`: `tsc --noEmit`, `eslint`
  - `mobile-test`: `jest --ci`
  - `mobile-build-android`: `eas build --platform android --profile preview --non-interactive` (uses EAS, requires `EXPO_TOKEN` secret) — produces an APK uploaded as artifact
  - `sync-types`: runs `scripts/sync-types.sh`, fails on drift between `frontend/lib/api.ts` and `mobile/lib/api.ts`
- **DoD**:
  - [ ] CI runs on PRs that touch `mobile/**`
  - [ ] EAS build succeeds and APK is downloadable from the workflow run

### M0.7 — EAS + Play Store setup
- **Files**:
  - `mobile/eas.json` (preview + production profiles)
  - `docs/mobile-deploy.md` — runbook: signing keystore, EAS submit, Play Console internal track
- **DoD**:
  - [ ] One successful EAS preview build (APK installable on a physical Android)
  - [ ] Internal track listing created in Play Console (manual step, documented)

---

## Phase M1 — Mobile features (parallel after M0)

Mirror the web feature set. Each task is one agent, end-to-end, file-isolated. Tests written first.

### M1.1 — Auth screens
- **Spec**: `docs/features/auth.md`
- **Files**:
  - `mobile/app/auth/login.tsx` (email + password form, "Continue with Google" button)
  - `mobile/app/auth/callback.tsx` (Expo deep-link handler)
  - Tests: `mobile/__tests__/auth/`, `mobile/.maestro/auth.yaml`
- **DoD**: every acceptance criterion in `auth.md` passes against local Supabase

### M1.2 — Home + Search + Filter
- **Spec**: `docs/features/food-search.md`
- **Files**:
  - `mobile/app/index.tsx` (Home: SearchBar + CategoryGrid + Scan button)
  - `mobile/app/search.tsx` (results list with FilterPanel as bottom sheet)
  - `mobile/components/SearchBar.tsx`, `CategoryGrid.tsx`, `FilterPanel.tsx`, `FilterChips.tsx`, `ProductCard.tsx`
  - Tests: RTL + Maestro flow
- **DoD**: every acceptance criterion in `food-search.md` (mobile equivalent — drawer instead of sidebar)

### M1.3 — Food detail screen
- **Spec**: `docs/features/scoring.md`
- **Files**:
  - `mobile/app/food/[barcode].tsx`
  - `mobile/components/ScoreRing.tsx` (Skia or react-native-svg)
  - `mobile/components/ScoreBreakdown.tsx`, `NutritionTable.tsx`, `BodyImpactSummary.tsx`
  - Tests: RTL component tests + Maestro detail flow
- **DoD**: feature parity with web detail page; uses the same backend response

### M1.4 — Barcode scanner
- **Spec**: `docs/features/food-search.md` § Barcode Scan
- **Files**:
  - `mobile/app/scan.tsx` (`expo-camera` `CameraView` with `barCodeScannerSettings`)
  - Camera permission prompt + denied state
  - Tests: mocked camera in jest; Maestro flow gated on physical device or emulator with simulated camera
- **DoD**: scan a product barcode → navigate to `/food/[barcode]`; permission denied shows clear UI

### M1.5 — Alternatives
- **Spec**: `docs/features/alternatives.md`
- **Files**:
  - `mobile/components/AlternativeCard.tsx` (image, name, score badge, "Order on Amazon" link via `Linking.openURL`)
  - Extend `mobile/app/food/[barcode].tsx` with alternatives section
  - Tests: RTL + Maestro
- **DoD**: alternatives render; Amazon link opens external browser; cards work without an Amazon URL

### M1.6 — Profile + History
- **Spec**: `docs/requirements.md` FR-2 + FR-7
- **Files**:
  - `mobile/app/profile.tsx` (ConditionPicker — checkboxes)
  - `mobile/app/history.tsx` (list with image + name + score + scanned_at)
  - `mobile/components/ConditionPicker.tsx`
  - Tests: RTL + Maestro for the auth-gated flow
- **DoD**: feature parity with web; auth-gated; persists; clears on demand

---

## Phase M2 — Mobile polish

### M2.1 — Branding (icon, splash, store assets)
- App icon (1024x1024 master + adaptive icon foreground/background for Android 8+)
- Splash screen (matches web "Clean." + tagline)
- Play Store listing assets: feature graphic, screenshots, short + long description, privacy policy URL
- **DoD**: assets generated by `expo-asset-utils` or designed manually; committed under `mobile/assets/`

### M2.2 — Network resilience + offline state
- Banner when backend unreachable; cached product detail still readable from local async storage on next view
- Retry on transient errors with exponential backoff
- **DoD**: airplane mode + reopen scenario tested via Maestro

### M2.3 — Deep linking + shared URLs
- `clean://food/3017620422003` opens the detail screen directly
- App Links / Universal Links bound to `getclean.app/food/...` so a web link opens the app when installed
- **DoD**: tapping a shared link opens the right screen on both cold and warm app start

### M2.4 — Internal release on Play Store
- EAS submit → internal track
- 5–10 internal testers added by email (manual)
- **DoD**: testers can install via Play Store invite link; no crash on the golden path

### M2.5 — Production release
- Promote internal → closed beta → open beta → production
- Privacy policy + data safety form filled in Play Console
- **DoD**: app live on Play Store; install from a fresh device works end-to-end

---

## Ownership table

| ID | Task | Owner | Branch | PR | Status |
|----|------|-------|--------|----|--------|
| M0.1 | Project scaffold | — | — | — | TODO |
| M0.2 | Shared API client + types | — | — | — | TODO |
| M0.3 | Auth setup | — | — | — | BLOCKED on M0.1 |
| M0.4 | Theme + UI primitives | — | — | — | BLOCKED on M0.1 |
| M0.5 | Test infrastructure | — | — | — | BLOCKED on M0.1 |
| M0.6 | Mobile CI | — | — | — | BLOCKED on M0.5 |
| M0.7 | EAS + Play Store setup | — | — | — | BLOCKED on M0.6 |
| M1.1 | Auth screens | — | — | — | BLOCKED on M0.* |
| M1.2 | Home + Search + Filter | — | — | — | BLOCKED on M0.* |
| M1.3 | Food detail | — | — | — | BLOCKED on M0.* |
| M1.4 | Barcode scanner | — | — | — | BLOCKED on M1.3 |
| M1.5 | Alternatives | — | — | — | BLOCKED on M1.3 |
| M1.6 | Profile + History | — | — | — | BLOCKED on M1.1 |
| M2.1 | Branding | — | — | — | BLOCKED on M1.* |
| M2.2 | Resilience + offline | — | — | — | BLOCKED on M1.* |
| M2.3 | Deep linking | — | — | — | BLOCKED on M1.* |
| M2.4 | Internal release | — | — | — | BLOCKED on M0.7, M1.* |
| M2.5 | Production release | — | — | — | BLOCKED on M2.4 |

---

## Open questions before starting

1. **Bundle ID** — `app.getclean.clean` is a placeholder. Confirm before M0.1 (changing later requires re-creating the Play Store listing).
2. **iOS** — explicitly out of scope for now per your ask. Stack supports it for free if/when you want it; would add an `M0.8 (iOS) signing + TestFlight` task.
3. **Backend production URL** — mobile builds need `EXPO_PUBLIC_API_URL` baked in. Until T2.2 (web production deploy) lands, mobile dev/preview builds point at a local backend over a tunnel (or `adb reverse tcp:8000 tcp:8000`).
4. **Code-sharing between web + mobile** — the docs above use a "duplicate + sync script" approach. Alternative: extract `lib/api.ts` + types into a shared package (npm workspace). Decide before M0.2.
