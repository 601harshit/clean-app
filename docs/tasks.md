# Clean. — Task Breakdown

This document is the source of truth for who is doing what. Each task has a unique ID, owner type, dependencies, files, and acceptance criteria. Multiple agents work in parallel — claim a task by assigning yourself, do the work, open a PR. CI must be green before merge.

**Workflow per task**: branch from `main` → write/extend tests first (TDD) → implement until tests pass → push → CI green → PR → merge.

---

## Phase 0 — Foundation (sequential, must complete first)

These tasks establish shared infrastructure. They must be merged to `main` before any Phase 1 task starts. One agent owns Phase 0 end-to-end to avoid collisions on shared files.

### T0.1 — Repo housekeeping
- **Files**: `README.md`, `.gitignore` (verify), `LICENSE` (MIT), `docker-compose.yml` (placeholder)
- **DoD**:
  - [ ] `README.md` describes the project, quickstart commands, links to `docs/`
  - [ ] `.gitignore` covers Python (`__pycache__`, `.pytest_cache`, `.coverage`), Node (`node_modules`, `.next`), env files (`.env*` except `.env.example`), Supabase (`supabase/.branches`)

### T0.2 — Backend foundation
- **Spec**: `docs/lld.md` § Backend Module Structure
- **Files**:
  - `backend/pyproject.toml` (deps: fastapi, uvicorn, pydantic, pydantic-settings, httpx, supabase, anthropic, cachetools, python-dotenv)
  - `backend/app/main.py` (FastAPI app, CORS, router includes)
  - `backend/app/core/config.py` (pydantic-settings: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, AMAZON_*)
  - `backend/app/core/supabase.py` (Supabase admin client factory)
  - `backend/app/core/auth.py` (JWT verification dependency)
  - `backend/app/.env.example`
- **DoD**:
  - [ ] `uvicorn app.main:app --reload` starts without errors
  - [ ] `GET /health` returns `{"status": "ok"}`
  - [ ] CORS allows `http://localhost:3000`
  - [ ] Missing env vars cause startup failure with a clear error

### T0.3 — Backend shared models
- **Spec**: `docs/lld.md` § API Contracts
- **Files**:
  - `backend/app/models/food.py` — `Nutrient`, `ProductSummary`, `ScoreFactor`, `Alternative`, `FoodResult`, `SearchResponse`, `Category`
  - `backend/app/models/user.py` — `ProfileResponse`, `HistoryItem`
- **DoD**:
  - [ ] All Pydantic v2 models match the JSON shapes in `lld.md` exactly
  - [ ] `pytest backend/tests/models/` passes (round-trip serialization tests)

### T0.4 — Database migrations + Supabase local setup
- **Spec**: `docs/lld.md` § Database Schema
- **Files**:
  - `supabase/config.toml` (Supabase CLI config)
  - `supabase/migrations/0001_initial_schema.sql` — `profiles`, `scan_history`, `food_insights`, `food_cache`, RLS policies, `handle_new_user` trigger
  - `supabase/seed.sql` — seed test users for E2E
  - Scripts: `scripts/db-reset.sh`, `scripts/db-seed.sh`
- **DoD**:
  - [ ] `supabase start` brings up local stack
  - [ ] `supabase db reset` applies migration cleanly
  - [ ] All four tables exist with correct columns and RLS
  - [ ] First sign-in auto-creates a `profiles` row (verified via test)

### T0.5 — Frontend foundation
- **Spec**: `docs/lld.md` § Frontend Component Tree
- **Files**:
  - `frontend/lib/supabase.ts` — browser Supabase client
  - `frontend/lib/supabase-server.ts` — server Supabase client
  - `frontend/lib/api.ts` — typed fetch wrappers (`searchFoods`, `getFoodByBarcode`, `getCategories`, `getProfile`, `updateProfile`, `getHistory`, `clearHistory`) — function bodies can be stubs that throw `NotImplemented`, only the **types** are required to match `models/food.py`
  - `frontend/middleware.ts` — protect `/profile`, `/history`
  - `frontend/app/layout.tsx` — replace default scaffold: nav header (logo, Search, History, Profile/Sign in), Tailwind theme tokens for "clean premium" branding
  - `frontend/app/page.tsx` — replace default scaffold: minimal landing (placeholder for SearchBar + CategoryGrid)
  - `frontend/.env.example`
- **DoD**:
  - [ ] `npm run dev` starts, default Next.js scaffold is gone
  - [ ] Layout renders nav + content slot
  - [ ] `lib/api.ts` types compile against `models/food.py` shapes (round-trip via fixture JSON)
  - [ ] Middleware redirects unauthed users from `/profile` to `/auth/login`

### T0.6 — Test infrastructure
- **Spec**: `docs/testing.md` (write this as part of the task)
- **Files**:
  - `docs/testing.md` — strategy doc, conventions, commands
  - `backend/pytest.ini` — coverage config, fail-under 90
  - `backend/tests/conftest.py` — fixtures: local Supabase client, test JWT minter, httpx test client, cassette helper
  - `backend/tests/cassettes/` — recorded HTTP responses for OFF, Claude, Amazon (5 sample products)
  - `frontend/jest.config.ts` — coverage thresholds 80
  - `frontend/jest.setup.ts`
  - `frontend/playwright.config.ts`
  - `docker-compose.yml` — Supabase + backend + frontend, all healthchecked
  - `scripts/test-all.sh` — runs everything locally end-to-end
- **DoD**:
  - [ ] `docker-compose up` brings up the full stack with healthchecks passing
  - [ ] `cd backend && pytest` runs (no tests yet, exit 0 with "no tests collected" allowed)
  - [ ] `cd frontend && npm test` runs (no tests yet)
  - [ ] `cd frontend && npx playwright test` runs (no tests yet)
  - [ ] `scripts/test-all.sh` exits 0 with all three reporting

### T0.7 — Record HTTP fixtures
- **Files**: `backend/tests/cassettes/*.json`
- **Sample products to record**:
  - Nutella — `3017620422003` (high sugar, high sat fat)
  - Greek yogurt — pick one with `pnns_groups_1=dairy`
  - Plain rolled oats
  - Coca-Cola — `5449000000996` (high sugar)
  - Unknown barcode — `0000000000000` (404 path)
- **DoD**:
  - [ ] One cassette per product per service (OFF + Claude + Amazon where relevant)
  - [ ] `tests/cassettes/README.md` documents how to re-record

### T0.8 — CI workflow
- **Files**: `.github/workflows/ci.yml`
- **Jobs**: `backend-lint`, `backend-test`, `frontend-lint`, `frontend-test`, `e2e`, `deploy` (deploy commented out until hosting is set up)
- **DoD**:
  - [ ] Workflow file validates (`gh workflow view`)
  - [ ] Status: **advisory only initially** — branch protection not enforced for first 2 weeks
  - [ ] All jobs cache `pip`, `npm`, Playwright browsers

---

## Phase 1 — Features (parallel, claim and implement)

Each feature task is owned by one agent end-to-end: write failing tests against the spec, implement until green, open PR. Tasks within Phase 1 only touch their own files (see "Files" list) — if you find yourself editing another feature's files, stop and coordinate.

### T1.1 — Auth
- **Spec**: `docs/features/auth.md`
- **Depends on**: T0.2, T0.4, T0.5
- **Files**:
  - `frontend/app/auth/login/page.tsx`
  - `frontend/app/auth/callback/page.tsx`
  - Tests: `frontend/__tests__/auth/`, Playwright `e2e/auth.spec.ts`
- **DoD**: All acceptance criteria in `auth.md` pass; coverage thresholds hit.

### T1.2 — Food Search, Browse & Filter
- **Spec**: `docs/features/food-search.md`
- **Depends on**: T0.2, T0.3, T0.5, T0.7 (cassettes)
- **Files**:
  - Backend: `app/api/food.py` (search + categories endpoints), `app/services/food_service.py`
  - Frontend: `app/search/page.tsx`, `components/SearchBar.tsx`, `components/CategoryGrid.tsx`, `components/FilterPanel.tsx`, `components/FilterChips.tsx`, `components/ProductCard.tsx`
  - Tests: `backend/tests/api/test_food_search.py`, `backend/tests/services/test_food_service.py`, `frontend/__tests__/search/`, `e2e/search.spec.ts`
- **DoD**: All acceptance criteria in `food-search.md` pass.

### T1.3 — Scoring + Food Detail Page
- **Spec**: `docs/features/scoring.md`
- **Depends on**: T0.2, T0.3, T0.5, T0.7
- **Files**:
  - Backend: `app/api/food.py` (barcode endpoint), `app/services/scoring_service.py`, `app/services/food_service.py` (extend with `get_product`)
  - Frontend: `app/food/[barcode]/page.tsx`, `components/ScoreRing.tsx`, `components/ScoreBreakdown.tsx`, `components/NutritionTable.tsx`, `components/BodyImpactSummary.tsx`
  - Tests: `backend/tests/services/test_scoring_service.py` (table-driven, hundreds of cases), `backend/tests/api/test_food_barcode.py`, `frontend/__tests__/components/`, `e2e/detail.spec.ts`
- **DoD**: All acceptance criteria in `scoring.md` pass.

### T1.4 — LLM Body Impact Summary
- **Spec**: `docs/features/scoring.md` § AI Body Impact Summary, `docs/lld.md` § food_insights table
- **Depends on**: T1.3 (extends the same endpoint), T0.7 (Claude cassettes)
- **Files**:
  - `backend/app/services/llm_service.py`
  - Tests: `backend/tests/services/test_llm_service.py` (cache hit, cache miss, prompt assembly, fallback on API failure)
- **DoD**: Body impact text returned in `FoodResult.body_impact`; cache verified by asserting only one Claude call across two consecutive lookups.

### T1.5 — Barcode Scanner
- **Spec**: `docs/features/food-search.md` § Barcode Scan
- **Depends on**: T1.3 (detail page must exist as the navigation target)
- **Files**:
  - `frontend/components/BarcodeScanner.tsx`
  - Tests: `frontend/__tests__/components/BarcodeScanner.test.tsx` (mock camera stream), `e2e/scan.spec.ts` (skip in CI if no camera, run locally)
- **DoD**: All acceptance criteria for FR-4 in `requirements.md` pass.

### T1.6 — Healthier Alternatives
- **Spec**: `docs/features/alternatives.md`
- **Depends on**: T1.3
- **Files**:
  - `backend/app/services/amazon_service.py`
  - Extend `app/services/food_service.py` with `get_alternatives()`
  - `frontend/components/AlternativeCard.tsx`
  - Extend `app/food/[barcode]/page.tsx` with alternatives section
  - Tests: `backend/tests/services/test_amazon_service.py`, `backend/tests/services/test_alternatives.py`, `e2e/alternatives.spec.ts`
- **DoD**: All acceptance criteria in `alternatives.md` pass; alternatives are score ≥ 60 AND > current.

### T1.7 — Profile + History
- **Spec**: `docs/requirements.md` § FR-2, FR-7; `docs/lld.md` § Profile/History endpoints
- **Depends on**: T1.1 (auth), T0.4 (DB)
- **Files**:
  - Backend: `app/api/profile.py`, `app/api/history.py`
  - Frontend: `app/profile/page.tsx`, `app/history/page.tsx`, `components/ConditionPicker.tsx`
  - Tests: `backend/tests/api/test_profile.py`, `backend/tests/api/test_history.py`, `frontend/__tests__/profile/`, `e2e/profile.spec.ts`
- **DoD**: User can set conditions, conditions persist, history records every detail-page view, clear history works, RLS prevents cross-user access (verified by test).

---

## Phase 2 — Polish & Phase Boundaries

### T2.1 — End-to-end golden path E2E suite
- **Files**: `e2e/golden-paths.spec.ts`
- **Scenarios**:
  1. Guest searches → views detail → sees generic score and impact summary
  2. New user signs up → sets conditions → searches → sees personalized score
  3. User filters by Snacks + Safe for Diabetics → all results pass safety check
  4. User views detail → clicks alternative → lands on alternative's detail page
  5. User views same product twice → second view loads instantly (cache hit)

### T2.2 — Production deploy
- Vercel for frontend, Railway for backend, Supabase project (production)
- Env vars set in each platform
- Domain wired (`getclean.app` or `itsclean.app`)
- CI workflow: enable deploy job on push to `main`
- Branch protection on `main`: require all CI checks to pass

### T2.3 — MCP server (Phase 3 — defer)
- **Spec**: `docs/features/mcp-server.md`
- Standalone, not blocking web app.

---

## Ownership table (assign as agents pick up work)

| ID | Task | Owner | Branch | PR | Status |
|----|------|-------|--------|-----|--------|
| T0.1 | Repo housekeeping | — | — | — | TODO |
| T0.2 | Backend foundation | — | — | — | TODO |
| T0.3 | Backend shared models | — | — | — | TODO |
| T0.4 | DB migrations + Supabase local | — | — | — | TODO |
| T0.5 | Frontend foundation | — | — | — | TODO |
| T0.6 | Test infrastructure | — | — | — | TODO |
| T0.7 | HTTP fixtures | — | — | — | TODO |
| T0.8 | CI workflow | — | — | — | TODO |
| T1.1 | Auth | — | — | — | BLOCKED on T0.* |
| T1.2 | Search + Browse + Filter | — | — | — | BLOCKED on T0.* |
| T1.3 | Scoring + Detail | — | — | — | BLOCKED on T0.* |
| T1.4 | LLM body impact | — | — | — | BLOCKED on T1.3 |
| T1.5 | Barcode scanner | — | — | — | BLOCKED on T1.3 |
| T1.6 | Alternatives | — | — | — | BLOCKED on T1.3 |
| T1.7 | Profile + History | — | — | — | BLOCKED on T1.1, T0.4 |
| T2.1 | Golden path E2E | — | — | — | BLOCKED on T1.* |
| T2.2 | Production deploy | — | — | — | BLOCKED on T2.1 |
| T2.3 | MCP server | — | — | — | DEFERRED (Phase 3) |
