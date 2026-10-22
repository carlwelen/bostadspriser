---
name: Booli scraper specifics
description: Verified Booli sold-listings URL pattern, area IDs, payload shape, and known quirks (district leakage, epoch fallback, dataPoints positional)
type: project
---

Verified 2026-05-03 via live probe.

**URL pattern:** `https://www.booli.se/sok/slutpriser?areaIds=<id>&objectType=L%C3%A4genhet&page=<n>` — ~35 SoldProperty cards/page; sorted by soldDate desc.

**Area IDs (SubAdministrativeArea / Stadsdel under Stockholms kommun):**
- ostermalm: 115348
- vasastan: 115349
- norrmalm: 115350
- sodermalm: 115341

Looked up via Booli's GraphQL endpoint `operationName=areaSuggestionSearch` (Apollo persistedQuery). If IDs ever change, repeat the typeahead probe — the endpoint itself is public.

**Payload shape:** data lives in `__NEXT_DATA__.props.pageProps.__APOLLO_STATE__`, entries with `__typename == "SoldProperty"`. Fields used:
- `id` / `booliId` — natural key (we use `id`); persists across re-scrapes.
- `streetAddress` — split on last space into (street, houseNumber) when last token has a digit; same heuristic as Hemnet.
- `soldDate` — ISO date string `"YYYY-MM-DD"` (no timezone math needed, but parser tolerates epoch seconds for safety).
- `soldPrice.raw` — int kr; `soldPrice.formatted` is the kr-with-NBSP fallback.
- `latitude` / `longitude` — top-level floats; populated for almost all cards.
- `displayAttributes.dataPoints[]` — **positional, label-less** entries. Pick by content shape: contains "m²" without "kr" → area; contains "rum" → rooms; contains "kr/m²" → per-sqm.
- `descriptiveAreaName` — used to filter cross-district leakage. Booli's pagination occasionally pulls in adjacent stadsdelar.

**Quirks:**
- Per-sqm not always shipped as a dataPoint — derive from `priceSek/areaSqm` when missing.
- Cookie consent (didomi) overlay blocks UI clicks but does not affect server-rendered `__NEXT_DATA__`, so no action needed for scraping.
- Behind Cloudflare like Hemnet — same Playwright + warmup + storageState approach. Storage state is shared across both sources (same file).
- `_looks_real()` requires `SoldProperty` or `propertySearch` in the HTML to reject soft-404 templates that still embed an empty Apollo cache.

**File anchors:**
- `scraper/src/scraper/booli.py` — implementation, mirrors `hemnet.py` structure.
- `scraper/src/scraper/run.py` — `scrape --source hemnet|booli`; `update` iterates all sources × districts; MAX(soldAt) lookup scoped per (district, source).
- `scraper/tests/test_booli_parser.py` — fixture-based parser tests, including epoch fallback and locale strings.
