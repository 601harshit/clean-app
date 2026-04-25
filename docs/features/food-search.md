# Feature Spec: Food Search, Browse & Filter

## Goal
Let users find food products by text search or barcode scan, browse by category, and filter results by score, condition safety, Nutri-Score, and NOVA group — so a diabetic user can instantly surface foods that are genuinely safe for them.

## User Stories
- As a user, I can type a food name in the search bar and see matching products.
- As a user, I can browse a food category (e.g., "Snacks") without any search query.
- As a user, I can filter results to show only products that are "Safe for Diabetics".
- As a user, I can combine filters — e.g., Snacks + Safe for Diabetics + Score ≥ 60.
- As a user, I can share a filtered URL with someone and they see the same results.
- As a user, I can tap "Scan Barcode" and point my camera at a product to go directly to its detail page.

## Scope
- Text search via Open Food Facts search endpoint
- Category browsing via Open Food Facts category filter
- Client-side filter chips for: score tier, condition safety, Nutri-Score grade, NOVA group
- Barcode scan via `@zxing/browser` (web only)
- Filter state encoded in URL query string

## Out of Scope
- Voice search
- Searching by nutrient (e.g., "high protein")
- Saved/named filter presets

---

## Condition Safety Definition

"Safe for [condition]" means the product does **not** trigger any penalty for that condition in the scoring algorithm. Specifically:

| Filter | Safe if... |
|--------|-----------|
| Safe for Diabetics | sugars ≤ 15g/100g AND carbohydrates ≤ 40g/100g |
| Safe for Cholesterol | saturated_fat ≤ 5g/100g AND fat ≤ 20g/100g |
| Safe for Hypertension | sodium ≤ 0.3g/100g |
| Safe for Obesity | energy_kcal ≤ 400/100g |

These thresholds match the scoring modifier thresholds in `docs/lld.md`.

---

## Acceptance Criteria

### Search
- [ ] Search bar on home page and `/search` page
- [ ] Input debounced 400ms before firing API call; minimum 2 characters
- [ ] Results show: product image, name, brand, health score badge, Nutri-Score grade
- [ ] Loading skeleton shown while fetching
- [ ] "No results found" empty state with illustration
- [ ] Clicking a result navigates to `/food/[barcode]`

### Category Browse
- [ ] Home page shows a row of category chips (e.g., Snacks, Dairy, Beverages, Cereals, Condiments, Frozen)
- [ ] Clicking a category navigates to `/search?category=snacks` and shows results for that category with no text query
- [ ] Category is shown as an active filter chip in the results page

### Filters
- [ ] Filter panel available on `/search` page (sidebar on desktop, bottom sheet on mobile)
- [ ] **Score tier**: radio — All / Good+ (≥60) / Excellent (≥80)
- [ ] **Condition safety**: multi-select checkboxes — Safe for Diabetics, Safe for Cholesterol, Safe for Hypertension, Safe for Obesity
- [ ] **Nutri-Score**: multi-select checkboxes — A, B, C, D, E
- [ ] **NOVA group**: multi-select checkboxes — 1 (Unprocessed), 2 (Processed ingredients), 3 (Processed), 4 (Ultra-processed)
- [ ] Active filters shown as removable chips above results
- [ ] Removing a chip clears that filter and re-fetches
- [ ] "Clear all filters" button resets everything
- [ ] Filter state reflected in URL query params (shareable)
- [ ] Result count displayed: "142 products"

### Barcode Scan
- [ ] "Scan" button opens camera view (requests permission if not granted)
- [ ] On successful barcode decode, navigates to `/food/[barcode]`
- [ ] If camera permission denied, show clear error message
- [ ] If barcode not found in Open Food Facts, show "Product not found" on the detail page (not a crash)

### General
- [ ] Search and browse work for unauthenticated users (scores shown are generic)
- [ ] All filters work on mobile (responsive, large tap targets)
- [ ] Pagination: "Load more" button (not infinite scroll) — 20 results per page

---

## API

### Search & Browse
`GET /api/food/search`

Query params:
| Param | Type | Description |
|-------|------|-------------|
| `q` | string (optional) | Search term. If omitted with `category`, browses category |
| `category` | string (optional) | Open Food Facts category slug |
| `page` | int (default 1) | Page number |
| `min_score` | int (optional) | Minimum score (e.g., 60 for Good+, 80 for Excellent) |
| `safe_for` | string[] (optional) | Condition safety filters: `diabetes`, `cholesterol`, `hypertension`, `obesity` |
| `nutri_score` | string[] (optional) | e.g., `A`, `B` |
| `nova_group` | int[] (optional) | e.g., `1`, `2` |

Response:
```json
{
  "products": [ProductSummary],
  "total": 142,
  "page": 1
}
```

`ProductSummary` now includes `score` and `condition_flags`:
```json
{
  "barcode": "...",
  "name": "...",
  "brand": "...",
  "image_url": "...",
  "nutri_score": "B",
  "nova_group": 2,
  "score": 74
}
```

### Categories
`GET /api/food/categories`

Returns a curated list of top-level categories:
```json
{
  "categories": [
    { "slug": "snacks", "label": "Snacks", "icon": "🍿" },
    { "slug": "dairy", "label": "Dairy", "icon": "🥛" },
    { "slug": "beverages", "label": "Beverages", "icon": "🧃" },
    { "slug": "cereals", "label": "Cereals", "icon": "🥣" },
    { "slug": "condiments", "label": "Condiments", "icon": "🧴" },
    { "slug": "frozen", "label": "Frozen", "icon": "🧊" },
    { "slug": "breads", "label": "Breads", "icon": "🍞" },
    { "slug": "meats", "label": "Meats", "icon": "🥩" }
  ]
}
```

---

## Backend Filtering Logic

Filtering happens **server-side** in `food_service.py`:

1. Call Open Food Facts with `q`, `category`, `nutriscore_grade`, `nova_group` params (supported natively by OFF API)
2. For each returned product, compute its score via `scoring_service.compute_score()` (no user conditions — generic score for browse)
3. Apply `min_score` filter: drop products where `score < min_score`
4. Apply `safe_for` filters: for each selected condition, check the nutrient thresholds against that condition's rules; drop products that fail any selected condition
5. Return filtered + paginated results

Note: `safe_for` filtering is **condition-specific** and independent of the user's own health profile — it's a search filter, not personalization.

---

## Implementation Notes
- `/search` page is the full search/browse/filter page; home page just has the search bar + category chips as entry points
- `SearchBar.tsx` — on submit navigates to `/search?q={term}`, does not show inline dropdown (that's a UX simplification for the full filter page)
- `FilterPanel.tsx` — sidebar on md+, bottom sheet (drawer) on mobile
- `FilterChips.tsx` — row of active filter pills with × to remove each
- `CategoryGrid.tsx` — horizontal scrollable row of category cards on home
- `BarcodeScanner.tsx` — `"use client"`, uses `@zxing/browser` `BrowserMultiFormatReader`, cleans up reader on unmount
- URL params: `?q=&category=&min_score=&safe_for=diabetes,hypertension&nutri_score=A,B&nova_group=1,2&page=1`
- Nutri-Score badge colors: A=green-600, B=lime-500, C=yellow-400, D=orange-400, E=red-500

---

## Files to Create/Modify
- `frontend/app/page.tsx` — SearchBar + CategoryGrid + BarcodeScanner
- `frontend/app/search/page.tsx` — full results page with FilterPanel + results grid
- `frontend/components/SearchBar.tsx`
- `frontend/components/CategoryGrid.tsx`
- `frontend/components/FilterPanel.tsx`
- `frontend/components/FilterChips.tsx`
- `frontend/components/BarcodeScanner.tsx`
- `frontend/components/ProductCard.tsx` — card used in search results grid
- `frontend/lib/api.ts` — `searchFoods(params)`, `getCategories()` functions
- `backend/app/api/food.py` — `GET /api/food/search`, `GET /api/food/categories`
- `backend/app/services/food_service.py` — `search_products(params)`, `get_categories()`
- `backend/app/models/food.py` — `ProductSummary`, `SearchResponse`, `SearchParams`, `Category`
