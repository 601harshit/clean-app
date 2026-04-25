# Clean. — High-Level Design

## System Architecture

```
┌─────────────────────────────────────────────────────┐
│                   User's Browser                    │
│         Next.js 14 (App Router) — Vercel            │
└────────────────────┬────────────────────────────────┘
                     │ HTTPS / REST
                     ▼
┌─────────────────────────────────────────────────────┐
│             FastAPI Backend — Railway               │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────┐ │
│  │ /food    │  │ /profile  │  │ /alternatives    │ │
│  └────┬─────┘  └─────┬─────┘  └────────┬─────────┘ │
│       │              │                  │           │
│  ┌────▼──────────────▼──────────────────▼─────────┐ │
│  │           Services Layer                       │ │
│  │  food_service  scoring_service  amazon_service │ │
│  └────┬──────────────┬──────────────────┬─────────┘ │
└───────┼──────────────┼──────────────────┼───────────┘
        │              │                  │
        ▼              ▼                  ▼
  Open Food      Supabase DB        Amazon PA
  Facts API      (PostgreSQL)       API v5
```

## Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| Next.js frontend | UI rendering, camera access for barcode scan, calls backend REST API only — no direct calls to Open Food Facts or Supabase from the browser |
| FastAPI backend | All business logic: food lookup, score calculation, alternative ranking, Amazon affiliate link fetching |
| Supabase Auth | User identity, JWT issuance, Google OAuth |
| Supabase DB (PostgreSQL) | Stores user profiles (health conditions) and scan history; RLS enforces per-user isolation |
| Open Food Facts API | Product data source: nutrition facts, Nutri-Score, NOVA group, category, images |
| Amazon PA API v5 | Returns purchasable alternatives with affiliate-tagged URLs |

## Data Flow

### Search Flow
```
1. User types in search box (debounce 400ms)
2. Frontend → GET /api/food/search?q={term}&page=1
3. Backend → Open Food Facts search API
4. Backend maps results to ProductSummary (name, brand, image, nutri_score)
5. Frontend renders result list
```

### Barcode Scan Flow
```
1. User clicks "Scan" → browser requests camera permission
2. @zxing/browser decodes barcode from video stream
3. Frontend → GET /api/food/barcode/{barcode}  (same as detail flow below)
```

### Food Detail Flow
```
1. Frontend → GET /api/food/barcode/{barcode}  (JWT in Authorization header if logged in)
2. Backend fetches product from Open Food Facts
3. Backend extracts nutrients + Nutri-Score + NOVA
4. scoring_service computes score:
   a. Base score from Nutri-Score + NOVA
   b. If JWT present → fetch user health conditions from Supabase
   c. Apply condition modifiers
5. amazon_service searches for alternatives in same category with higher score
6. If user authenticated → save to scan_history
7. Return FoodResult (product + score + breakdown + alternatives)
8. Frontend renders detail page
```

## Authentication Flow
```
1. User signs in via Supabase Auth (email or Google)
2. Supabase issues JWT
3. Frontend stores session via @supabase/ssr (cookie-based)
4. All authenticated backend requests include: Authorization: Bearer <jwt>
5. Backend verifies JWT via Supabase public key — no backend DB call needed for auth
```

## Phase Boundaries

| Phase | Scope |
|-------|-------|
| Phase 1 | Next.js web app + FastAPI backend (this document) |
| Phase 2 | React Native app — calls the **same** FastAPI backend, no backend changes |
| Phase 3 | MCP server (Python `mcp` SDK) — thin wrapper over scoring_service |
