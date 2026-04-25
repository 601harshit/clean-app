# Feature Spec: Food Search & Barcode Scan

## Goal
Let users find any food product by name/brand text search or by scanning its barcode with their phone/webcam camera.

## User Stories
- As a user, I can type a food name in the search bar and see matching products.
- As a user, I can click a search result to go to its detail page.
- As a user, I can tap "Scan Barcode" and point my camera at a product to go directly to its detail page.

## Scope
- Text search via Open Food Facts search endpoint
- Barcode scan via `@zxing/browser` (web only)
- Results show: name, brand, image, Nutri-Score badge

## Out of Scope
- Voice search
- Searching by nutrient (e.g., "high protein")

## Acceptance Criteria
- [ ] Search bar on home page (`/`)
- [ ] Input debounced 400ms before firing API call
- [ ] Minimum 2 characters to trigger search
- [ ] Results dropdown shows up to 10 items with product name, brand, thumbnail, Nutri-Score badge
- [ ] Loading spinner shown while fetching
- [ ] "No results found" state shown when Open Food Facts returns empty
- [ ] Clicking a result navigates to `/food/[barcode]`
- [ ] "Scan" button opens camera view (requests permission if not granted)
- [ ] On successful barcode decode, navigates to `/food/[barcode]`
- [ ] If camera permission denied, show clear error message
- [ ] If barcode not found in Open Food Facts, show "Product not found" on the detail page (not a crash)
- [ ] Search works on mobile (responsive, large tap targets)

## API Used
`GET /api/food/search?q={query}&page={page}`

Backend calls: `https://world.openfoodfacts.org/cgi/search.pl?search_terms={query}&json=true&page_size=10&page={page}&fields=code,product_name,brands,image_thumb_url,nutriscore_grade`

## Implementation Notes
- `SearchBar.tsx` — controlled input, debounced with `useEffect` + `setTimeout`, shows floating results list
- `BarcodeScanner.tsx` — `"use client"`, uses `@zxing/browser` `BrowserMultiFormatReader`, cleans up reader on unmount
- Nutri-Score badge color mapping: A=green, B=light-green, C=yellow, D=orange, E=red

## Files to Create/Modify
- `frontend/app/page.tsx` — compose SearchBar + BarcodeScanner
- `frontend/components/SearchBar.tsx`
- `frontend/components/BarcodeScanner.tsx`
- `frontend/lib/api.ts` — `searchFoods(query, page)` function
- `backend/app/api/food.py` — `GET /api/food/search`
- `backend/app/services/food_service.py` — `search_products(query, page)`
- `backend/app/models/food.py` — `ProductSummary`, `SearchResponse`
