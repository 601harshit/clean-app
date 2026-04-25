# Test cassettes

Recorded HTTP responses replayed in tests via `respx`. Tests run offline, deterministically, with no external API calls.

## Layout

```
cassettes/
├── openfoodfacts/   # Real recordings from world.openfoodfacts.org
│   ├── nutella.json              # 3017620422003 — high sugar, high sat fat
│   ├── coca_cola.json            # 5449000000996 — high sugar beverage
│   ├── greek_yogurt.json         # 0894700010014 — high protein, low sugar
│   ├── rolled_oats.json          # 3229820019307 — whole grain
│   ├── unknown_barcode.json      # 0000000000000 — 404 / status:0 path
│   └── search_chocolate.json     # cgi/search.pl?search_terms=chocolate
├── claude/          # SYNTHETIC (hand-crafted) — see note below
│   ├── body_impact_nutella_diabetes.json
│   └── body_impact_yogurt_guest.json
└── amazon/          # Empty — credentials not yet available
```

## Synthetic Claude cassettes

The `claude/*` cassettes are **hand-crafted** to match the Anthropic Messages API response shape, marked with `_synthetic: true`. We don't have an `ANTHROPIC_API_KEY` wired up to record real responses yet.

**When a real key is available, re-record:**
```bash
ANTHROPIC_API_KEY=... RECORD_CASSETTES=1 \
  pytest backend/tests/services/test_llm_service.py
```

Delete the `_synthetic`, `_note`, and `_request_summary` fields after recording — those exist only to make the synthetic origin obvious.

## Amazon cassettes

Empty until Amazon Product Advertising API access is granted. PA API requires an active affiliate account with qualifying sales — we'll record cassettes once `T2.2` (production deploy) generates revenue. Until then, `amazon_service` tests should skip with a clear reason.

## Re-recording Open Food Facts

```bash
cd backend/tests/cassettes/openfoodfacts
curl -s -A "Clean.App-Test/1.0" \
  "https://world.openfoodfacts.org/api/v2/product/3017620422003.json" \
  -o nutella.json
```

Bump cassettes when:
- Adding a new test product
- An OFF response shape changes (rare, but possible)

Never silently — always commit the cassette in the same PR as the test that uses it.

## Scrubbing

OFF responses contain no secrets. Claude responses must NOT include real API keys in headers — synthetic cassettes contain no headers, and `respx` recordings are configured in `conftest.py` to scrub `Authorization` and `x-api-key` before persisting. If you ever record a real response by hand, double-check those are absent.
