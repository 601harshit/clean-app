# Clean. — Testing Strategy

## Philosophy

Tests are the contract between agents and the spec. Every acceptance criterion in `docs/features/*.md` must map to at least one automated test. Tests are **written first** (TDD) — the test file is the executable definition of "done".

**Local-first**: every test must run on a developer's machine without hitting production services. The same `docker-compose.yml` and same fixtures run locally and in CI. "Works on my machine" is not a valid failure mode.

**No mocks for things we own**: integration tests hit a real local Supabase, not a mocked DB. Mocks for external APIs (Open Food Facts, Claude, Amazon) use **recorded HTTP responses** (cassettes), not hand-written fakes — so we exercise real parsing and error-handling paths.

---

## Test Pyramid

| Layer | Tool | What it covers | Speed | Coverage target |
|-------|------|---------------|-------|-----------------|
| Backend unit | `pytest` | Pure functions: `scoring_service`, prompt assembly, parsers | <100ms each | 95%+ |
| Backend integration | `pytest` + `httpx.AsyncClient` | API endpoints against local Supabase + cassettes | <5s each | 90%+ |
| Backend external-API | `pytest` + `respx` | `food_service`, `llm_service`, `amazon_service` against cassettes | <500ms each | 90%+ |
| Frontend component | `Jest` + `React Testing Library` | Component behavior, props, interactions | <500ms each | 80%+ |
| E2E | `Playwright` | Golden user paths against full local stack | <30s each | All FRs covered |

**Aggregate coverage thresholds enforced in CI**: backend 90%, frontend 80%. CI build fails below.

---

## Tools

### Backend
- `pytest` — test runner
- `pytest-asyncio` — async test support
- `pytest-cov` — coverage
- `pytest-watch` (`ptw`) — watch mode for local dev
- `httpx[http2]` — async HTTP client (also used for testing FastAPI via `AsyncClient`)
- `respx` — HTTP request interception for cassettes
- `freezegun` — freeze time for cache TTL tests
- `python-jose` — mint test JWTs that match Supabase's signing key

### Frontend
- `Jest` + `@testing-library/react` + `@testing-library/user-event`
- `@testing-library/jest-dom` — DOM matchers
- `msw` — request mocking for component tests that hit `lib/api.ts`
- `Playwright` — E2E

### Local stack
- `Supabase CLI` (requires Docker) — runs Postgres + GoTrue + PostgREST locally
- `docker-compose` — orchestrates Supabase + backend + frontend together

---

## Local Setup (one-time)

```bash
# 1. Install Docker Desktop and start it
# 2. Install Supabase CLI
brew install supabase/tap/supabase

# 3. Backend deps
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

# 4. Frontend deps
cd ../frontend && npm ci

# 5. Playwright browsers
npx playwright install --with-deps chromium

# 6. Bring up local Supabase + apply migrations + seed
cd .. && supabase start
supabase db reset    # applies migrations and seed.sql

# 7. Verify
./scripts/test-all.sh
```

After setup, the everyday loop is just `docker-compose up` + your test runner.

---

## Running Tests

### Backend
```bash
cd backend
pytest                              # all tests, with coverage
pytest -x                           # stop on first failure
pytest --lf                         # only re-run last failed
pytest tests/services/test_scoring_service.py::test_diabetes_penalty   # single test
ptw -- -x                           # watch mode (re-runs on save)
```

### Frontend
```bash
cd frontend
npm test                            # all Jest tests, with coverage
npm test -- --watch                 # watch mode
npm test -- --onlyChanged           # only files affected by current edits
npx playwright test                 # E2E (full stack must be up)
npx playwright test --ui            # E2E in interactive mode (great for debugging)
```

### Everything
```bash
./scripts/test-all.sh               # backend pytest + frontend jest + playwright, in sequence
```

---

## Conventions

### File layout
```
backend/tests/
├── conftest.py                # shared fixtures: supabase_client, http_client, jwt_for_user
├── cassettes/                 # recorded HTTP responses (one file per fixture set)
│   ├── nutella.yaml
│   ├── greek_yogurt.yaml
│   └── README.md
├── unit/                      # pure-function tests (no I/O)
│   └── test_scoring_service.py
├── services/                  # service-layer tests (with cassettes)
│   ├── test_food_service.py
│   ├── test_llm_service.py
│   └── test_amazon_service.py
├── api/                       # endpoint tests (httpx.AsyncClient + local Supabase)
│   ├── test_food_search.py
│   ├── test_food_barcode.py
│   ├── test_profile.py
│   └── test_history.py
└── models/
    └── test_serialization.py

frontend/__tests__/
├── components/
│   ├── ScoreRing.test.tsx
│   ├── FilterPanel.test.tsx
│   └── BodyImpactSummary.test.tsx
├── auth/
├── search/
└── profile/

e2e/                           # Playwright specs (in repo root)
├── auth.spec.ts
├── search.spec.ts
├── detail.spec.ts
├── alternatives.spec.ts
├── profile.spec.ts
└── golden-paths.spec.ts
```

### Test naming
- Backend: `test_<unit_under_test>_<scenario>` (e.g. `test_compute_score_diabetes_penalty_applied_when_sugar_exceeds_threshold`)
- Frontend: `it("does X when Y")`
- One assertion concept per test. Use parametrize/`it.each` for table-driven tests.

### Acceptance criteria → tests
Each `[ ]` checkbox in a feature spec maps to a test. The test docstring or `it()` description should reference the FR or acceptance criterion ID.

```python
def test_alternatives_score_at_least_60(client):
    """FR-6.4: Alternatives must score >= 60 and > current product"""
    ...
```

---

## HTTP Cassettes

We record real HTTP responses from external APIs once, commit them to the repo, and replay them in tests. Tests run offline, deterministically, and free.

### Recording
```bash
RECORD_CASSETTES=1 pytest backend/tests/services/test_food_service.py::test_get_nutella
# This hits the real OFF API, writes the response to backend/tests/cassettes/nutella.yaml
```

### Replaying (default behavior)
Tests use the `respx` `MockRouter` configured by `conftest.py` to intercept httpx calls and return cassette content. No external network in tests.

### When to re-record
- API contract changes (rare for OFF, possible for Claude)
- Adding a new test product
- **Never** silently — always commit the new cassette in the same PR as the test using it

### Cassette files
- One cassette per `(service, fixture)` pair: `cassettes/openfoodfacts/nutella.json`, `cassettes/claude/body_impact_nutella_diabetes.json`, etc.
- Sensitive headers (auth tokens) scrubbed before commit — `conftest.py` enforces this on save.

---

## Local Supabase

`supabase start` launches a complete Supabase stack in Docker:
- Postgres on `localhost:54322`
- GoTrue (auth) on `localhost:54321/auth/v1`
- PostgREST on `localhost:54321/rest/v1`
- Studio (web UI) on `localhost:54323`

The local instance gets a fixed anon key + service-role key (printed by `supabase status`). These are the values backend tests use — never production keys.

### Fixtures using local Supabase
```python
# conftest.py
@pytest.fixture(scope="session")
def supabase():
    """Real Supabase client pointed at local stack."""
    return create_client(LOCAL_SUPABASE_URL, LOCAL_SUPABASE_SERVICE_KEY)

@pytest.fixture
def reset_db(supabase):
    """Truncate user tables between tests; run migrations once per session."""
    yield
    supabase.table("scan_history").delete().neq("id", "").execute()
    supabase.table("profiles").delete().neq("id", "").execute()

@pytest.fixture
def authed_client(supabase):
    """Returns (httpx.AsyncClient, user_id, jwt) for an authenticated test user."""
    user = supabase.auth.admin.create_user({"email": "test@example.com", "password": "..."})
    jwt = mint_test_jwt(user.id)
    client = AsyncClient(app=app, base_url="http://test", headers={"Authorization": f"Bearer {jwt}"})
    yield client, user.id, jwt
    supabase.auth.admin.delete_user(user.id)
```

---

## Coverage

### Backend
`pyproject.toml`:
```toml
[tool.coverage.run]
source = ["app"]
omit = ["app/main.py"]   # entrypoint, exercised by integration tests

[tool.coverage.report]
fail_under = 90
show_missing = true
```

### Frontend
`jest.config.ts`:
```ts
coverageThreshold: {
  global: { branches: 80, functions: 80, lines: 80, statements: 80 }
}
```

Both runners exit non-zero if thresholds aren't met → CI build fails automatically.

---

## CI

GitHub Actions runs the same commands in `.github/workflows/ci.yml`. Jobs:

1. `backend-lint` — `ruff check . && mypy app`
2. `backend-test` — `pytest` (with local Postgres via `services:` in the workflow, NOT full Supabase CLI — for speed)
3. `frontend-lint` — `npm run lint && tsc --noEmit`
4. `frontend-test` — `npm test`
5. `e2e` — `docker-compose up -d && npx playwright test` — **runs only after the four above pass**

For the first 2 weeks: CI is **advisory** (status checks visible but don't block merges). After that, branch protection requires all green.

### CI vs local Supabase trade-off
- **Local**: full Supabase CLI for fidelity (Auth + DB + RLS + triggers all real)
- **CI**: just Postgres as a service, with our migrations applied — faster, no CLI install. RLS still tested. The few Auth-specific tests are tagged `@pytest.mark.requires_supabase_cli` and skipped in CI but run locally and in nightly E2E.

---

## Debugging Failures

### Test is flaky
Don't `pytest.mark.flaky` it. Find the cause:
- Race condition? Add explicit await or use `asyncio.gather`.
- Time-dependent? `freezegun`.
- Test order dependency? Add `--randomly` to surface it, then fix the bad fixture.

### Cassette mismatch
`respx` raises if a request is made that no cassette matches. Re-record the cassette or check that the test is calling the right endpoint.

### Playwright failure on CI but pass locally
Check uploaded artifacts — Playwright records video and screenshots on failure. URL in the failed CI job page.

### Coverage just dropped below threshold
`pytest --cov-report=html && open htmlcov/index.html` — shows uncovered lines.

---

## Anti-patterns

- ❌ Mocking the database — use real local Postgres
- ❌ Hand-written fakes for OFF/Claude/Amazon — use cassettes
- ❌ Skipping a test to "fix later" — either fix or delete
- ❌ Asserting on entire JSON blobs — assert on the specific fields you care about
- ❌ Sleeping in tests — use `freezegun` for time, explicit awaits for async
- ❌ Tests that depend on external network — every test must run with `--no-network` (a future CI guard)
