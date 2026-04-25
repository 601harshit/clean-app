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
- AI body impact summary (personalized, cached)

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
- [ ] AI body impact summary shown just below the score ring, 2–3 sentences
- [ ] Summary is personalized when user has conditions (e.g., mentions diabetes impact specifically)
- [ ] Summary is generic when user is a guest
- [ ] Cached: viewing the same product with the same conditions never triggers a new LLM call
- [ ] If LLM call fails, section is silently omitted — does not break the page

## Scoring Algorithm
See `docs/lld.md` — Scoring Algorithm section.

## API Used
`GET /api/food/barcode/{barcode}`  (with optional JWT)

## Implementation Notes
- `ScoreRing.tsx` — SVG circle with stroke-dashoffset animation on mount
- Score color: `score >= 60 ? 'green' : score >= 40 ? 'yellow' : 'red'`
- `ScoreBreakdown.tsx` — collapsible list (collapsed by default on mobile)
- `NutritionTable.tsx` — simple table, highlight rows that triggered a penalty in red

## AI Body Impact Summary

A short Claude-generated summary explaining what this food does to the user's body. Details of the prompt, cache key, and DB table are in `docs/lld.md`.

### Expected output examples
**Nutella, diabetic + cholesterol user:**
> "Nutella is extremely high in sugar (56g/100g) and saturated fat, making it a poor choice for both blood sugar management and heart health. The rapid glucose spike from this much sugar is particularly risky for diabetics, and the 10g of saturated fat per 100g actively works against cholesterol management. The small amount of hazelnut protein (6g) is the only meaningful nutritional upside."

**Plain Greek Yogurt, no conditions:**
> "Plain Greek yogurt is a nutritionally dense food — its high protein content (10g/100g) supports muscle repair and keeps you full longer. The live cultures benefit gut health, and it's naturally low in sugar. It's one of the few high-protein foods that also delivers meaningful calcium."

## Files to Create/Modify
- `frontend/app/food/[barcode]/page.tsx` — server component, fetches via `lib/api.ts`
- `frontend/components/ScoreRing.tsx`
- `frontend/components/ScoreBreakdown.tsx`
- `frontend/components/NutritionTable.tsx`
- `frontend/components/BodyImpactSummary.tsx` — renders the AI summary text
- `frontend/lib/api.ts` — `getFoodByBarcode(barcode, jwt?)` function
- `backend/app/api/food.py` — `GET /api/food/barcode/{barcode}`
- `backend/app/services/food_service.py` — `get_product(barcode)`
- `backend/app/services/scoring_service.py` — `compute_score(nutrients, nutri_score, nova, conditions)`
- `backend/app/services/llm_service.py` — `get_body_impact(product, conditions) -> str | None`
- `backend/app/models/food.py` — `FoodResult`, `Nutrient`, `ScoreFactor`
