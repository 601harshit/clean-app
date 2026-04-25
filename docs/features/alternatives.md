# Feature Spec: Healthier Alternatives

## Goal
After viewing a food's score, show users up to 5 healthier alternatives in the same category, each with an Amazon affiliate link to buy it.

## User Stories
- As a user, I can see healthier alternatives to the food I'm viewing.
- As a user, I can click an alternative to order it on Amazon.
- As a user, clicking an alternative's name navigates to its own detail page in Clean.

## Scope
- Alternatives section at the bottom of `/food/[barcode]`
- Alternatives fetched from Open Food Facts (same category, score ≥ 60 and strictly higher than current product)
- Amazon affiliate link for each alternative via Amazon PA API v5

## Out of Scope
- Filtering alternatives by dietary restrictions beyond the user's health conditions
- Sorting alternatives manually

## Acceptance Criteria
- [ ] Alternatives section shows up to 5 cards
- [ ] Each card: product image, name, brand, health score badge, "Order on Amazon" button
- [ ] All alternatives have a score ≥ 60 ("Good" or better) AND strictly higher than the current product's score
- [ ] "Order on Amazon" link opens in a new tab with affiliate tag
- [ ] Clicking product name/image navigates to `/food/[barcode]` for that alternative
- [ ] If Amazon PA API is unavailable, alternative cards still show (without the Amazon button); no error crash
- [ ] If fewer than 5 alternatives are found, show however many are available
- [ ] If no alternatives found, show "No healthier alternatives found for this product"
- [ ] Section shows a loading skeleton while fetching (alternatives are included in the main `GET /api/food/barcode/{barcode}` response — no separate load)

## Algorithm for Selecting Alternatives
1. Get the product's Open Food Facts category (use `pnns_groups_1` or `categories_tags[0]`)
2. Search Open Food Facts for products in that category with `nutriscore_grade` better than current
3. Compute score for each candidate (using user's conditions)
4. Keep only those with `score >= 60` (i.e. "Good" or better) AND `score > current_product_score`
5. Sort by score descending, take top 5
6. For each, call Amazon PA API `SearchItems` with the product name → get first result's URL + affiliate tag

## Amazon PA API Notes
- Operation: `SearchItems`
- `Keywords`: `"{product_name} {brand}"`
- `SearchIndex`: `"Grocery"` (try `"HealthPersonalCare"` as fallback if no results)
- `Resources`: `["ItemInfo.Title", "Offers.Listings.Price", "Images.Primary.Medium"]`
- Tag: from env var `AMAZON_PARTNER_TAG`
- If no Amazon result found for an alternative, set `amazon_url: null` — show card without button

## Files to Create/Modify
- `frontend/components/AlternativeCard.tsx`
- `frontend/app/food/[barcode]/page.tsx` — render alternatives section
- `backend/app/services/amazon_service.py` — `get_affiliate_links(products: list[str]) -> dict[str, str]`
- `backend/app/services/food_service.py` — `get_alternatives(barcode, category, current_score, conditions)`
- `backend/app/models/food.py` — `Alternative` model
- `backend/app/core/config.py` — `AMAZON_ACCESS_KEY`, `AMAZON_SECRET_KEY`, `AMAZON_PARTNER_TAG`, `AMAZON_REGION`
