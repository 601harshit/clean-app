# Clean. — Low-Level Design

## Database Schema (Supabase / PostgreSQL)

```sql
-- auth.users is managed by Supabase Auth

create table public.profiles (
  id          uuid references auth.users(id) on delete cascade primary key,
  health_conditions text[] not null default '{}',
  -- valid values: 'diabetes' | 'cholesterol' | 'hypertension' | 'obesity'
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.scan_history (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade not null,
  barcode      text,
  product_name text not null,
  brand        text,
  image_url    text,
  score        integer not null,
  scanned_at   timestamptz not null default now()
);

create index on public.scan_history (user_id, scanned_at desc);

-- AI body impact summary cache
create table public.food_insights (
  barcode         text not null,
  conditions_key  text not null,  -- sorted comma-joined conditions, e.g. "diabetes,hypertension" or "" for guest
  message         text not null,
  created_at      timestamptz not null default now(),
  primary key (barcode, conditions_key)
);
-- No RLS: cache is shared across all users with the same condition combo, not user-specific
```

### RLS Policies
```sql
-- profiles
alter table public.profiles enable row level security;
create policy "users manage own profile"
  on public.profiles for all using (auth.uid() = id);

-- scan_history
alter table public.scan_history enable row level security;
create policy "users manage own history"
  on public.scan_history for all using (auth.uid() = user_id);
```

---

## API Contracts

Base URL: `https://api.getclean.app` (Railway)

All authenticated endpoints require: `Authorization: Bearer <supabase_jwt>`

---

### Food Endpoints

#### `GET /api/food/search`
Query params:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | — | Search term (optional if `category` provided) |
| `category` | string | — | OFF category slug for browsing |
| `page` | int | 1 | Page number (20 per page) |
| `min_score` | int | — | Minimum score threshold (e.g., 60, 80) |
| `safe_for` | string[] | — | `diabetes`, `cholesterol`, `hypertension`, `obesity` |
| `nutri_score` | string[] | — | `A`, `B`, `C`, `D`, `E` |
| `nova_group` | int[] | — | `1`, `2`, `3`, `4` |

Response `200`:
```json
{
  "products": [
    {
      "barcode": "3017620422003",
      "name": "Nutella",
      "brand": "Ferrero",
      "image_url": "https://images.openfoodfacts.org/...",
      "nutri_score": "E",
      "nova_group": 4,
      "score": 12
    }
  ],
  "total": 142,
  "page": 1
}
```

Response `422`: invalid query params (must provide at least `q` or `category`)

---

#### `GET /api/food/categories`
No params.

Response `200`:
```json
{
  "categories": [
    { "slug": "snacks", "label": "Snacks", "icon": "🍿" },
    { "slug": "dairy", "label": "Dairy", "icon": "🥛" }
  ]
}
```

---

#### `GET /api/food/barcode/{barcode}`
Auth: optional (personalized score if JWT provided)

Response `200`:
```json
{
  "barcode": "3017620422003",
  "name": "Nutella",
  "brand": "Ferrero",
  "image_url": "https://images.openfoodfacts.org/...",
  "nutri_score": "E",
  "nova_group": 4,
  "nutrients": {
    "energy_kcal": 539,
    "fat": 30.9,
    "saturated_fat": 10.6,
    "carbohydrates": 57.5,
    "sugars": 56.3,
    "fiber": 3.0,
    "proteins": 6.3,
    "sodium": 0.107
  },
  "score": 12,
  "score_label": "Avoid",
  "score_breakdown": [
    { "factor": "Nutri-Score E", "impact": -25, "reason": "Poor nutritional quality" },
    { "factor": "Ultra-processed (NOVA 4)", "impact": -15, "reason": "Highly processed food" },
    { "factor": "High sugar", "impact": -20, "reason": "Penalized for diabetes profile" }
  ],
  "body_impact": "Nutella is extremely high in sugar and saturated fat, making it a poor choice for blood sugar management and heart health. The rapid glucose spike from 56g of sugar per 100g is particularly risky for diabetics, and the 10g of saturated fat actively works against cholesterol management. The small hazelnut protein content is the only meaningful nutritional upside.",
  "alternatives": [
    {
      "barcode": "3760020507350",
      "name": "Justin's Almond Butter",
      "brand": "Justin's",
      "score": 74,
      "image_url": "https://...",
      "amazon_url": "https://www.amazon.com/dp/B00BLAH?tag=clean-20"
    }
  ],
  "personalized": true
}
```

Response `404`: product not found in Open Food Facts

---

### Profile Endpoints

#### `GET /api/profile` — Auth required
Response `200`:
```json
{ "health_conditions": ["diabetes", "hypertension"] }
```

#### `PUT /api/profile` — Auth required
Request:
```json
{ "health_conditions": ["diabetes"] }
```
Response `200`:
```json
{ "health_conditions": ["diabetes"] }
```

---

### History Endpoints

#### `GET /api/history` — Auth required
Response `200`:
```json
{
  "items": [
    {
      "id": "uuid",
      "barcode": "3017620422003",
      "product_name": "Nutella",
      "brand": "Ferrero",
      "image_url": "...",
      "score": 12,
      "scanned_at": "2026-04-25T10:00:00Z"
    }
  ]
}
```

#### `DELETE /api/history` — Auth required
Clears all history for the user. Response `204`.

---

## Scoring Algorithm

### Step 1: Base Score from Nutri-Score
| Nutri-Score | Base |
|-------------|------|
| A | 80 |
| B | 65 |
| C | 50 |
| D | 35 |
| E | 20 |
| Unknown | 50 (neutral) |

### Step 2: NOVA Group Penalty
| NOVA | Penalty |
|------|---------|
| 1 (unprocessed) | 0 |
| 2 (processed ingredients) | -5 |
| 3 (processed food) | -10 |
| 4 (ultra-processed) | -20 |
| Unknown | 0 |

### Step 3: Condition Modifiers (applied only if user has that condition)

**Diabetes**
- sugars > 15g/100g → -15
- carbohydrates > 40g/100g → -5

**High Cholesterol**
- saturated_fat > 5g/100g → -15
- fat > 20g/100g → -5

**Hypertension**
- sodium > 0.6g/100g → -20
- sodium > 0.3g/100g → -10 (only one tier applied)

**Obesity**
- energy_kcal > 400/100g → -10
- fiber > 3g/100g → +5 (satiety bonus)
- proteins > 10g/100g → +5 (satiety bonus)

### Condition Safety Thresholds (used for search filtering)

These same thresholds define the "Safe for X" search filters — a product is safe for a condition if it does **not** exceed any threshold for that condition:

| Condition | Safe if |
|-----------|---------|
| Diabetes | sugars ≤ 15g/100g AND carbohydrates ≤ 40g/100g |
| Cholesterol | saturated_fat ≤ 5g/100g AND fat ≤ 20g/100g |
| Hypertension | sodium ≤ 0.3g/100g |
| Obesity | energy_kcal ≤ 400/100g |

### Step 4: Clamp
`final_score = max(0, min(100, base + nova_penalty + sum(condition_modifiers)))`

### Score Labels
| Range | Label |
|-------|-------|
| 80–100 | Excellent |
| 60–79 | Good |
| 40–59 | Fair |
| 20–39 | Poor |
| 0–19 | Avoid |

---

## Frontend Component Tree

```
app/
├── layout.tsx              # Root layout: nav, auth context
├── page.tsx                # Home: search bar + scan button
├── food/[barcode]/
│   └── page.tsx            # Food detail page
├── history/
│   └── page.tsx            # Scan history (auth-gated)
├── profile/
│   └── page.tsx            # Health conditions form (auth-gated)
└── auth/
    ├── login/page.tsx
    └── callback/page.tsx   # Supabase OAuth callback

components/
├── ui/                     # shadcn/ui primitives
├── SearchBar.tsx           # Debounced search input + results dropdown
├── BarcodeScanner.tsx      # Camera feed + @zxing/browser decode
├── ScoreRing.tsx           # Circular score visual (0–100)
├── ScoreBreakdown.tsx      # Expandable list of score factors
├── NutritionTable.tsx      # Nutrient rows
├── AlternativeCard.tsx     # Alternative product + Amazon CTA
└── ConditionPicker.tsx     # Multi-select for health conditions

lib/
├── api.ts                  # All fetch calls to FastAPI backend
├── supabase.ts             # Supabase client (browser)
└── supabase-server.ts      # Supabase client (server components)
```

---

## Backend Module Structure

```
backend/app/
├── main.py                 # FastAPI app, CORS, router includes
├── core/
│   ├── config.py           # pydantic-settings: env vars
│   └── supabase.py         # Supabase admin client
├── api/
│   ├── food.py             # /api/food routes
│   ├── profile.py          # /api/profile routes
│   └── history.py          # /api/history routes
├── models/
│   ├── food.py             # FoodResult, ProductSummary, Nutrient, ScoreFactor
│   └── user.py             # ProfileResponse, HistoryItem
└── services/
    ├── food_service.py     # Open Food Facts API calls + parsing
    ├── scoring_service.py  # Score computation
    ├── llm_service.py      # Claude API body impact summary (cached in food_insights table)
    └── amazon_service.py   # Amazon PA API v5 alternative lookup
```
