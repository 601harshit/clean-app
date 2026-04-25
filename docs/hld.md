# Clean. — High-Level Design

## System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        User's Browser                            │
│              Next.js 14 (App Router) — Vercel                    │
└───────────────────────────┬──────────────────────────────────────┘
                            │ HTTPS / REST + JWT
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│                   FastAPI Backend — Railway                       │
│                                                                  │
│   ┌─────────────┐   ┌──────────────┐   ┌──────────────────────┐ │
│   │  /food      │   │  /profile    │   │  /history            │ │
│   └──────┬──────┘   └──────┬───────┘   └──────────┬───────────┘ │
│          │                 │                       │             │
│   ┌──────▼─────────────────▼───────────────────────▼──────────┐ │
│   │                    Services Layer                          │ │
│   │   food_service   scoring_service   llm_service             │ │
│   │   amazon_service                                           │ │
│   └──────┬──────────────┬──────────────┬─────────────┬────────┘ │
└──────────┼──────────────┼──────────────┼─────────────┼──────────┘
           │              │              │             │
           ▼              ▼              ▼             ▼
    Open Food        Supabase        Claude        Amazon PA
    Facts API        (Auth + DB)     Haiku API     API v5
```

## Supabase Internals

```
┌──────────────────────────────────────────────┐
│              Supabase (PostgreSQL)            │
│                                              │
│  ┌─────────────┐   ┌──────────────────────┐  │
│  │  auth.users │   │  public.profiles     │  │
│  │  (managed)  │──▶│  health_conditions[] │  │
│  └─────────────┘   └──────────────────────┘  │
│                                              │
│  ┌──────────────────────┐                    │
│  │  public.scan_history │                    │
│  │  per-user food log   │                    │
│  └──────────────────────┘                    │
│                                              │
│  ┌──────────────────────┐                    │
│  │  public.food_insights│  ← LLM cache       │
│  │  barcode + conditions│    (shared, no RLS) │
│  │  → body impact text  │                    │
│  └──────────────────────┘                    │
└──────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| Next.js frontend | UI rendering, camera access for barcode scan, calls backend REST API only — no direct calls to Open Food Facts or Supabase from the browser |
| FastAPI backend | All business logic: food lookup, scoring, body impact summary, alternative ranking, Amazon affiliate links |
| Supabase Auth | User identity, JWT issuance, Google OAuth |
| Supabase DB | User profiles (health conditions), scan history, LLM response cache |
| Open Food Facts API | Product data: nutrition facts, Nutri-Score, NOVA group, category, images |
| Claude Haiku API | Generates personalized body impact summaries |
| Amazon PA API v5 | Returns purchasable alternatives with affiliate-tagged URLs |

## Data Flows

### Search & Browse Flow
```
1. User types query or selects category + filters
2. Frontend → GET /api/food/search?q=...&category=...&safe_for=...
3. Backend → Open Food Facts API (with category/nutriscore filters)
4. Backend computes generic score for each result (no user conditions)
5. Backend applies min_score and safe_for filters server-side
6. Frontend renders product grid with filter chips
7. User clicks a product → navigate to /food/[barcode] → Food Detail Flow
```

### Barcode Scan Flow
```
1. User clicks "Scan" → browser requests camera permission
2. @zxing/browser decodes barcode from video stream (client-side, no API call)
3. On decode → navigate to /food/[barcode] (same as Food Detail Flow)
```

### Food Detail Flow
```
1. Frontend → GET /api/food/barcode/{barcode}  (+ JWT if logged in)
2. Backend → Open Food Facts API (product data)
3. scoring_service computes score:
   a. Base score from Nutri-Score + NOVA
   b. If JWT present → fetch user health conditions from Supabase profiles
   c. Apply condition modifiers → personalized score + breakdown
4. llm_service generates body impact summary:
   a. Check food_insights table (barcode + conditions_key)
   b. Cache hit → return stored message instantly
   c. Cache miss → call Claude Haiku API → store result → return message
5. amazon_service → Amazon PA API (alternatives in same category, score ≥ 60)
6. If user authenticated → insert row into scan_history
7. Return FoodResult to frontend
```

### Authentication Flow
```
1. User signs in via Supabase Auth (email/password or Google OAuth)
2. Supabase issues JWT, stored in cookie via @supabase/ssr
3. All authenticated backend requests carry: Authorization: Bearer <jwt>
4. Backend verifies JWT via Supabase public key (no DB round-trip for auth)
5. On first sign-in, DB trigger auto-creates a profiles row for the user
```

## Phase Boundaries

| Phase | Scope |
|-------|-------|
| Phase 1 | Next.js web app + FastAPI backend (this document) |
| Phase 2 | React Native app — calls the **same** FastAPI backend unchanged |
| Phase 3 | MCP server (Python `mcp` SDK) — thin wrapper over `scoring_service` and `food_service` |
