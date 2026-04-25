# Feature Spec: Food Detail & Health Score

## Goal
Show a user the full picture of a food product — nutrition facts, a 0–100 health score personalized to their conditions, and a breakdown explaining the score.

## User Stories
- As a guest, I can see a food's score based on nutritional quality alone.
- As a signed-in user with health conditions set, I see a score adjusted for my specific conditions.
- As a user, I can see exactly why a food scored the way it did.

## Scope
- Product detail page `/food/[barcode]`
- Score computation in `scoring_service.py`
- Score breakdown (per-factor impact list)
- Nutrition facts table
- Nutri-Score + NOVA display with explanations

## Out of Scope
- User being able to override individual nutrient thresholds
- Trend graph of scores over time (deferred)

## Acceptance Criteria
- [ ] Page shows product name, brand, image
- [ ] Large score ring displays 0–100 score with color (green ≥ 60, yellow 40–59, red < 40)
- [ ] Score label shown: Excellent / Good / Fair / Poor / Avoid
- [ ] If user is authenticated and has conditions set → `personalized: true` banner shown
- [ ] If user is not authenticated → "Sign in for personalized score" banner shown
- [ ] Nutri-Score badge (A–E) displayed with one-line explanation of what it means
- [ ] NOVA group (1–4) shown with label: Unprocessed / Processed ingredients / Processed / Ultra-processed
- [ ] Nutrition table shows: calories, fat, saturated fat, carbs, sugar, fiber, protein, sodium (per 100g)
- [ ] Score breakdown section shows each factor: factor name, +/- impact, reason text
- [ ] Breakdown factors are sorted by absolute impact (largest first)
- [ ] Page renders correctly when Nutri-Score or NOVA is missing from Open Food Facts data

## Scoring Algorithm
See `docs/lld.md` — Scoring Algorithm section.

## API Used
`GET /api/food/barcode/{barcode}`  (with optional JWT)

## Implementation Notes
- `ScoreRing.tsx` — SVG circle with stroke-dashoffset animation on mount
- Score color: `score >= 60 ? 'green' : score >= 40 ? 'yellow' : 'red'`
- `ScoreBreakdown.tsx` — collapsible list (collapsed by default on mobile)
- `NutritionTable.tsx` — simple table, highlight rows that triggered a penalty in red

## Files to Create/Modify
- `frontend/app/food/[barcode]/page.tsx` — server component, fetches via `lib/api.ts`
- `frontend/components/ScoreRing.tsx`
- `frontend/components/ScoreBreakdown.tsx`
- `frontend/components/NutritionTable.tsx`
- `frontend/lib/api.ts` — `getFoodByBarcode(barcode, jwt?)` function
- `backend/app/api/food.py` — `GET /api/food/barcode/{barcode}`
- `backend/app/services/food_service.py` — `get_product(barcode)`
- `backend/app/services/scoring_service.py` — `compute_score(nutrients, nutri_score, nova, conditions)`
- `backend/app/models/food.py` — `FoodResult`, `Nutrient`, `ScoreFactor`
