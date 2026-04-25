# Clean. — Requirements

## Functional Requirements

### FR-1: Authentication
- FR-1.1: User can sign up with email + password
- FR-1.2: User can sign in with email + password
- FR-1.3: User can sign in with Google OAuth
- FR-1.4: User can sign out
- FR-1.5: Unauthenticated users can search and scan food (guest mode); scores are not personalized
- FR-1.6: Authenticated users get a personalized score based on their health profile

### FR-2: Health Profile
- FR-2.1: Authenticated users can select zero or more health conditions: Diabetes, High Cholesterol, Hypertension, Obesity
- FR-2.2: Profile is saved to Supabase and persists across sessions
- FR-2.3: User can update their conditions at any time

### FR-3: Food Search, Browse & Filter
- FR-3.1: User can type a food name or brand to search
- FR-3.2: Results show: product name, brand, image thumbnail, health score, and Nutri-Score grade
- FR-3.3: Minimum 2 characters triggers search; debounce 400ms
- FR-3.4: Paginated results (20 per page)
- FR-3.5: User can browse foods by category (e.g., Snacks, Dairy, Beverages, Cereals) without a search query
- FR-3.6: User can filter results by score tier: All / Good+ (≥60) / Excellent (≥80)
- FR-3.7: User can filter results by condition safety: "Safe for Diabetics", "Safe for Cholesterol", "Safe for Hypertension", "Safe for Obesity" — filters out products that trigger a penalty for that condition
- FR-3.8: User can filter by Nutri-Score grade (multi-select: A, B, C, D, E)
- FR-3.9: User can filter by NOVA group (multi-select: 1, 2, 3, 4)
- FR-3.10: Multiple filters can be applied simultaneously
- FR-3.11: Active filters are shown as removable chips above results
- FR-3.12: Filter state is preserved in the URL query string (shareable/bookmarkable links)
- FR-3.13: Result count is shown ("142 products")

### FR-4: Barcode Scan (web)
- FR-4.1: User can activate camera to scan a product barcode
- FR-4.2: On successful decode, immediately navigate to that product's detail page
- FR-4.3: If barcode not found in Open Food Facts, show a friendly "not found" state

### FR-5: Food Detail & Health Score
- FR-5.1: Show product name, brand, image
- FR-5.2: Show health score (0–100); higher = healthier for the user
- FR-5.3: Show score label: Excellent (80–100), Good (60–79), Fair (40–59), Poor (20–39), Avoid (0–19)
- FR-5.4: Show Nutri-Score grade (A–E) and NOVA group (1–4) with brief explanations
- FR-5.5: Show full nutrition facts (calories, fat, saturated fat, carbs, sugar, fiber, protein, sodium)
- FR-5.6: Show score breakdown: list of factors with their impact (positive/negative) and a human-readable reason
- FR-5.7: If user is not authenticated, score uses no condition modifiers and a banner prompts sign-in for personalization
- FR-5.8: Show a 2–3 sentence AI-generated body impact summary explaining what this food does to the user's body in plain English, covering both positive and negative effects
- FR-5.9: The body impact summary is personalized to the user's health conditions when logged in; generic when guest
- FR-5.10: The body impact summary is cached (by barcode + conditions combination) so repeated lookups never re-call the LLM

### FR-6: Healthier Alternatives
- FR-6.1: Show up to 5 healthier alternatives for the viewed product
- FR-6.2: Each alternative shows: name, brand, health score, and an "Order on Amazon" link (affiliate)
- FR-6.3: Alternatives are from the same product category (Open Food Facts category)
- FR-6.4: Alternatives must have a strictly higher score than the current product

### FR-7: Scan History
- FR-7.1: For authenticated users, every viewed food detail page is saved to scan history
- FR-7.2: User can view their recent 20 items on a history page
- FR-7.3: User can clear their history

---

## Non-Functional Requirements

### NFR-1: Performance
- NFR-1.1: Search results rendered within 1.5s of user input (including API round-trip)
- NFR-1.2: Food detail page (score + alternatives) rendered within 2s
- NFR-1.3: Backend score computation under 100ms

### NFR-2: Security
- NFR-2.1: No API keys exposed to the browser — all external API calls via backend
- NFR-2.2: Supabase RLS enforced: users can only read/write their own profile and history rows
- NFR-2.3: All backend endpoints that access user data require valid Supabase JWT
- NFR-2.4: Amazon PA API credentials stored only in Railway env vars

### NFR-3: Usability & Design
- NFR-3.1: Mobile-first responsive design
- NFR-3.2: Branding: Clean., minimal, premium — white/zinc palette, tight typography
- NFR-3.3: WCAG 2.1 AA accessibility (contrast ratios, keyboard navigation, ARIA labels)

### NFR-4: Reliability
- NFR-4.1: If Open Food Facts API is down, return a clear error (do not crash)
- NFR-4.2: If Amazon PA API is down, omit alternatives section gracefully (show "alternatives unavailable")
- NFR-4.3: If a product has no Nutri-Score or NOVA data, scoring falls back to nutrition-only calculation

### NFR-5: Extensibility
- NFR-5.1: Backend scoring logic must be isolated in a single service (`scoring.py`) — easy to tune modifiers
- NFR-5.2: All env vars documented in `.env.example` files
- NFR-5.3: Phase 2 (React Native) reuses the FastAPI backend with no changes
