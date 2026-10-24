# Backlog ledger

Single source of truth for the hardening loop. A resumed session told "continue from docs/backlog.md" should read **Orchestration state** first and then pick up the next `todo` / `in-progress` rows.

## Orchestration state

- **Current phase:** ACTIVE (2026-10-24). Baseline75c5d66 was green. B13 and earlier B46/B16 handoff work are fully merged; original C handoff is fully merged. E F20 approved, F28 awaiting fresh review, F11/F12 paint-order follow-up underway. Next merge E handoff oldest-first, then prepared C F16/B51/B14 and remaining P1/P2 work. No remote pushes.
- **Gate:** `scripts/check.sh` (typecheck, lint with zero warnings, vitest unit + integration, production build, Playwright e2e desktop + mobile, ruff, pytest). Must be green after every merge to `main`.
- **Process:** implementer agents (B scraper, C data/API, D map UI, E analytics UI) work in their own git worktrees, at most 3 at a time, one commit per backlog ID. A fresh reviewer (R) checks each task's diff and proving test. Only the orchestrator merges into `main`, one task at a time, re-running the gate after each merge. **Only the orchestrator edits this file**, so it never conflicts across worktrees; agents report status back to it.
- **Per-worktree isolation:** each role uses its own test DB and e2e port: B → `TEST_DB_NAME=bostadspriser_test_b E2E_PORT=3102`, C → `_c`/3103, D → `_d`/3104, E → `_e`/3105, orchestrator on `main` → `bostadspriser_test` (default)/3100. Never the dev DB `bostadspriser`.
- **Known-failing pins:** baseline bugs with a reproducing e2e test are marked `test.fail(...)` (or in `KNOWN_CONSOLE_ERRORS`) in `web/e2e/` with their ID. The fixing commit flips them to normal tests.
- **Gotcha (R-confirmed):** Recharts 3.8.1 + React 19 + Next 15.5 — `isAnimationActive={false}` on PriceChart series silently stops client-side `<Link>` navigation from committing on production builds. Never set it.
- **Platform gotchas fixed on main:** hidden `.pth` files on macOS/Python 3.13 (pytest `pythonpath`, check.sh `chflags`); stale `.next/types` after route moves (check.sh drops them).
- **Worktree note:** agent worktrees start from the initial commit; implementers fast-forward to `main` first (they did so in P1). Worktrees live in `.claude/worktrees/` (gitignored).
- **Most recent merge:** final B13 b0bf127 → f8b53db, full gate green. B handoff complete; original C handoff already fully merged; E waits final review fixes.
- **Active worktrees:** B `/tmp/bostadspriser-hardening-b` (`handoff/b-scraper`); E `/tmp/bostadspriser-hardening-e` (`handoff/e-analytics`); C `/tmp/bostadspriser-hardening-c` (`hardening/c-data`) preparing F16/B51 behind the handoff queue. Implementers use gpt-6.1-sol; each fresh reviewer uses gpt-6-astra. Browser gates require execution outside the macOS sandbox (Chromium MachPortRendezvous permission denial inside it); the unrestricted baseline passed.
- **Audit rounds completed:** 0 (stop condition needs two consecutive rounds with no new P0/P1).

Status values: `todo`, `in-progress`, `review`, `done`, `BLOCKED: needs owner decision`.
Owners: A platform, B scraper, C data/API, D map UI, E analytics UI.

## Phase 0: baseline

| ID | P | Owner | Status | Acceptance | Commit | Notes |
|---|---|---|---|---|---|---|
| P0.1 | - | A | done | Repo under git with an untouched baseline commit | 5cbdd95 | Repo was already initialised ("Initial commit") |
| P0.2 | - | A | done | pnpm install / prisma generate / tsc / lint / build / uv sync / pytest / ruff all green on macOS + Node 26 | be6641b | Dropped linux-only oxide binary; pnpm 12 `allowBuilds`; root `.env` loaded via `@next/env`; sitemap made dynamic (B24 build part) |
| P0.3 | - | A | done | Vitest unit + integration harness on a real test DB, Playwright e2e smoke, pytest `db` fixture, `scripts/check.sh` | 51cfb49 | See CLAUDE.md "Testing" |
| P0.4 | - | A | done | CLAUDE.md / README.md / agent memory paths match reality | 51cfb49 | |
| P0.5 | - | A | done | This ledger seeded with every item | 51cfb49 | |

## Backend / data

| ID | P | Owner | Status | Acceptance | Commit | Notes |
|---|---|---|---|---|---|---|
| B1 | P0 | B | done | `scraper update` MAX(soldAt) query works (no `:d::` bind bug); DB test covers it | f10d9d2 | R approved |
| B2 | P0 | B | done | One `parse_street_address()` in normalize.py used by both sources; table test incl. `S:t Eriksgatan`, `Karlavägen 1 A`, `Ringvägen 12-14`, `Hornsgatan 64 1tr`, `Odengatan 5, lgh 1101` | 0d23680, b7021d5, f3585e9, d43c69a, 4b91e70 | R approved; B2 review 5 (tr word boundary) approved, merges with the B16 series |
| B3 | P0 | B | done | `scraper reparse [--dry-run]` re-derives street/house/rooms/area/prices/dedupKey from `raw`, batched, idempotent; backfill batched too | 70678c0, fc0cec9 | R approved after review fix (soldAt re-derived, round_1dp, FOR UPDATE) |
| B4 | P0 | B | done | Rows without a final price are skipped (no `0` prices / `::0` dedup keys); Hemnet derives kr/m² from price/area when missing | 71528f6 | R approved |
| B5 | P0 | C | done | `rooms=5` on /api/heatmap means `>= 5` ("5+"); integration test with a 6-room row | 81407a0, 3eb3933 | R approved |
| B6 | P0 | C | done | Every API route validates params (400 + JSON error on bad/negative/huge input); DB errors → 500 JSON + server log; tests per bad input | 22c2bea, 154e705, dc00c52 | R approved after 2 review rounds; zod schemas in `src/lib/api-validation.ts`, types in `src/lib/api-types.ts` |
| B7 | P0 | C | done | MoM uses the last two complete, adjacent months; `null` when either has < N sales | 94301cd | R approved; UI hint follow-up F31 |
| B8 | P0 | C | done | `/api/address` applies the period to `addressSales` | b60d13c | R approved |
| B9 | P0 | C→B | done | Prisma migration adds `lastSeenAt` (C); scraper sets it on every upsert and the view tie-breaks on it (B) | 6809084, 60db229 | Both halves R approved |
| B10 | P0 | B | done | Upsert keeps existing lat/lng/geocodedAt when incoming coords are NULL (DB test) | 07ba608 | R approved |
| B11 | P0 | B | done | probe scripts fixed or deleted; nothing imports `DISTRICT_URLS` | 7bb57d6 | R approved; probe scripts deleted |
| B12 | P0 | B | done | `update` exits non-zero if any source/district fails and prints a summary table | fff39cc | R approved |
| B30 | P0 | C | done | `isDistrictSlug` rejects prototype keys (`toString`, `constructor`, `__proto__`); unit test | 19badf9 | R approved |
| B31 | P1 | B | done | `db.engine()` pins session `timezone=UTC` so `timestamp(3)` columns don't depend on server TimeZone; test | 0f56124, b3b6744 | R approved |
| B32 | P1 | B | done | Source iterators signal an incomplete crawl (page fetch failed mid-pagination) so `update` reports `partial` and exits non-zero | b3355d4, acd182e | R approved |
| B33 | P3 | B | done | Unify Hemnet/Booli geocodedAt stamping (`is not None`) | cdc61ba | Folded into B17 |
| B34 | P1 | C | done | `sinceDays`/period cut-offs (heatmap, address, topMovers) use Stockholm's current date explicitly, not the session `CURRENT_DATE` | a17a1de | R approved; `stockholmToday(asOf)` in aggregations.ts |
| B35 | P0 | B | done | Pagination doesn't stop on a page whose cards were all skipped (only on soldAt < since / empty page / no parseable date ≥ since); test both sources | 0687c0c | R approved |
| B36 | P2 | B | todo | Reviewed purge/flag for legacy rows reparse reports unparseable (e.g. `reparse --prune-unparseable`) | | From R review of B4 |
| B37 | P0 | B | done | Crawl stops on a repeated page (same card ids) and at a hard MAX_PAGES cap; runaway test guard can't be swallowed | 9a8c918, ebf1923 | R approved |
| B38 | P1 | C | done | DedupedListing prefers priced rows (`pricePerSqmSek > 0`) before other tie-breakers | e1a1b46 | R approved |
| B39 | P1 | B | done | A partial crawl must not advance the `update` cutoff (no permanent gap in the failed tail) | a5089df, 2f4f6cf | R approved; crawl_state.json "complete through" per source/district |
| F33 | P1 | D | done | Drawer never shows the previous address's data while a new one loads; "Försök igen" after error | 7e92e3a | R approved; a11y focus-after-retry nit → D |
| B43 | P1 | B | done | Single-instance `flock` lock for scrape/update/reparse; second run exits non-zero | 0633d16, a0ba25f | R approved |
| B44 | P1 | B | done | Deep backfill not capped forever by MAX_PAGES: `scraper backfill --resume` with recorded progress, explicit `--max-pages` | 1457ded, 067e67a | R approved |
| B45 | P2 | B+C | todo | Move crawl_state.json (update cutoffs, backfill resume) into ScrapeRun (`kind`, `lastPage` columns); resumed backfills don't count as freshness | | From B/R |
| B46 | P1 | B | done | Scraper calls `refresh_deduped_listing()` after every writing command (guarded until the function exists), `refresh-view` command, mat-vs-live count check in `stats` | 3730bfa, e021c63 | R approved; B+C integration verified |
| B47 | P3 | B | todo | Parser: floor marker after a range letter (`2-3B tr`, `2-3 t r`) | | From R review of B2 |
| B48 | P2 | B | done | Geocode exit codes: 75 rate-limited/unavailable, 78 bad token, 1 internal, 0 ok | aab93a9 | R approved; 75 rate-limited/unavailable, 78 bad token, 1 internal, 0 ok |
| B49 | P2 | B | todo | Scraper calls `POST /api/revalidate` (Bearer REVALIDATE_SECRET, APP_URL) right after `refresh_deduped_listing()`; failure logs, never aborts | | From R review of B24 |
| B51 | P2 | C | review | Explicit `cacheMaxMemorySize` (8–16 MB) and no caching of null `streetFromSlug` results; docs say serialised-size bound | 081ccb7 | 16MiB serialized cache bound and uncached slug misses; full gate417 web/112 e2e/450 pytest. Fresh R active; pending behind E handoff queue. |
| B52 | P2 | C | todo | recentSales excludes unpriced rows consistently with summary counts, so displayed X of Y cannot exceed Y | | From E handoff review; confirmed current SQL lacks pricePerSqmSek > 0. |
| B13 | P1 | C+B | done | Fuzzy cross-source matcher: same normalized address, dates within 3 days, prices within 0.5%; compatible area/rooms; at most one dedupKey per source in a cluster; corrections undo stale matches | ae5be64, 0d3c916, e87d287, 25ed187, f8b53db | Fresh R approved combined stack; all three commits merged via merge-seq with full gate green after each. Final main:407 vitest,112 e2e,488 pytest. Real PostgreSQL lock timeout/retry and correction snapshot verified independently. |
| B14 | P1 | B+C | in-progress | Ingest sanity bounds (area 10–400, kr/m² 20k–400k, rooms 1–15) reject + count; SQL exposes median + count everywhere; UI defaults to median | 272f279, 6435fe3, acd9acb (review) | C follow-up acd9acb ready: explicit median MoM plus period-filtered SQL drawer streetSummary; full gate420 web/112 e2e/450 pytest; fresh R active. E/D adoption and B ingest bounds remain. |
| B15 | P1 | B | todo | Check SaleCard for an area/location name and filter on it, or record that none exists | | |
| B16 | P1 | B(+C) | BLOCKED: needs owner decision | Geocode: status/retry column, 429 backoff, display-name query, inner-Stockholm bbox + reject outside; (d) storage terms | a9ca105, 2e3669e, 58ed86a, 5b3428b, aab93a9, 0ee3ae5 | Engineering work merged through review 4 (R approved). Only Mapbox storage terms remain; see Owner decisions. |
| B17 | P1 | B | done | Shared browser/source base; sources only define URL, `_looks_real`, extraction, `_to_row`; characterisation tests first | cdc61ba, 930c658 | R approved; guardrail diff byte-identical; shared core in source_base.py |
| B18 | P1 | C+B | in-progress | `ScrapeRun` model (C); scraper writes it and uses `logging` (B); web shows freshness (F18) | 4893c3c, 1457ded, ad0f8ab, 15c9b9a | Scraper side done (R approved). Remaining: UI F18 → E |
| B19 | P1 | B | done | Oldest-covered date per source/district; `scraper backfill --source --district --since --resume` | 1457ded | R approved (backfill --resume) |
| B20 | P1 | B | done | Batched upserts (page or 100 rows per transaction) | 5516ecc, a1fc82e | R approved |
| B21 | P2 | C | done | Measure ~200k rows + EXPLAIN ANALYZE into docs/perf.md; materialized view or `isCanonical`; re-measure | 9f50c89, 48475c2, de5cf76, 0ca2091 | Materialized DedupedListingMat; docs/perf.md 0.9–2.3s → ≤175ms at 200k rows; refreshed by scraper (B46) |
| B22 | P2 | C+B | todo | Persisted `streetSlug` + index, shared slug vectors, React `cache()` on lookups | | Depends on B23. `streetFromSlug` scans all district streets; E added `resolveStreet.ts` cache() wrapper in F26 |
| B23 | P2 | C(+B,D,E) | in-progress | One slug/fold implementation in `web/src/lib/text.ts`; `shared/slug-vectors.json` asserted by pytest and vitest | adfa1f9 | lib/text.ts + shared/slug-vectors.json merged. Open: pytest vectors (B), StreetSearch/AddressDrawer adopt (D) |
| B24 | P2 | C/E | done | `revalidate` or tag caching + secret `POST /api/revalidate`; build never needs a DB | a710400, e9f574c | Memory-only data cache + POST /api/revalidate. Scraper call → B49; memory bound → B51 |
| B25 | P2 | C | done | Deliberate heatmap cap, minimal properties, bbox/zoom filtering, gzip; documented; response reports truncation | a330a23, 5cabe19 | Cap 30k + truncated flag. UI hint for truncated → D (open) |
| B26 | P2 | C | done | topMovers: disjoint windows, higher thresholds, medians, expose n | 957efe8, 81c2f7d, 82525af | Insights copy → F35 (E) |
| B27 | P2 | C | done | Inline SQL in /api/address, /api/heatmap, /api/streets/all moved to aggregations.ts | 1906cab, d143604 | R approved; snapshots pinned to a fixed clock |
| B28 | P3 | C | todo | PostGIS only if B21/B25 measurements justify it | | |
| B29 | P3 | A/B | todo | Dockerfile + cron/systemd example for `update && geocode`, with lockfile | | |

## Frontend

| ID | P | Owner | Status | Acceptance | Commit | Notes |
|---|---|---|---|---|---|---|
| F1 | P0 | E | done | Secondary pages scroll with real input; full-height/overflow lives in the map page wrapper | 7257cab | R approved. Follow-ups: F32 (footer overflow on mobile), StreetSearch scroll lock → F21; `h-dvh` without fallback accepted |
| F2 | P0 | D | done | Deselecting every district shows the empty state (or the last can't be deselected), consistently | ab8c1ae | R approved |
| F3 | P0 | D | done | Map popups never inject scraped strings as HTML; test with a malicious address | 306a8f4 | R approved; nits (nbsp separator, regression-proof test) → D |
| F4 | P0 | E | done | `<html lang="sv">` | 6d1773c |  |
| F5 | P0 | D | done | Hex layer handlers registered once (no pile-up across mode switches) | 8a9e499 | R approved; real-mapbox-gl integration test → D nits |
| F6 | P0 | D | done | Missing Mapbox token → clear in-app message; remove the F6 entry from `KNOWN_CONSOLE_ERRORS` | 44b504c, 28003a6 | R approved; mobile layout now stacks map above sidebar (part of F20) |
| F7 | P0 | E/D | done | Copy reflects Booli + selected period; footer uses `DISTRICTS` display names | 384d821, 149a692 | E + D parts, R approved |
| F8 | P1 | E | review | Månad/År toggle on every time-series chart, in URL (`?g=year`), year buckets formatted `2025` |  | On handoff/e-analytics, R approved; branch merges as a unit after the F20/F11/F28 fixes (docs/review-probes/e-batch-review.md) |
| F9 | P1 | E | todo | Compare builder: add-series combobox (streets + districts), removable chips, "Jämför" buttons, dedupe, shared palette | | |
| F10 | P1 | E | review | House page shows address vs street vs district |  | On handoff/e-analytics, R approved; branch merges as a unit after the F20/F11/F28 fixes (docs/review-probes/e-batch-review.md) |
| F11 | P1 | E/D | in-progress | Numeric time axis with honest gaps (PriceChart E, AddressDrawer D) |  | 50859e7 fixed contrast but fresh R requested changes: later coincident street/district markers completely hide address rings. E preparing separate paint-order correction with real SVG hit-testing regression. D half remains. |
| F12 | P1 | E/D | in-progress | Tooltips show n; buckets with n < 3 de-emphasised |  | 50859e7 fixed contrast but fresh R requested changes: later coincident street/district markers completely hide address rings. E preparing separate paint-order correction with real SVG hit-testing regression. D half remains. |
| F13 | P1 | C+E | review | SQL `streetSummary` / `addressSummary` / `districtStreetCount`; correct labelled stats | 48d7aa0 | On handoff/e-analytics, R approved; branch merges as a unit after the F20/F11/F28 fixes (docs/review-probes/e-batch-review.md) |
| F14 | P1 | C | done | House numbers sort naturally in SQL | a5b5813, 1ced813 | R approved |
| F15 | P1 | D | done | Map filters round-trip through searchParams | 120347d, 7869c5a, 4efd397 | R approved; server-rendered from searchParams |
| F16 | P1 | E(+C) | review | Room/size segmentation chips on district + street pages | f50b6e8 | C half ready on hardening/c-data, full gate415 web/112 e2e/450 pytest; fresh R active. Undefined/[] all; FLOOR rooms below5;5 means5+. E UI follows handoff merge. |
| F17 | P1 | D(+C) | done | Data-driven quantile price legend; ramp + legend in one module | 2de7d86, 2aa4c76, 4efd397 | R approved; outlier-stretch follow-up in F38 |
| F18 | P1 | E | review | "Senast uppdaterad …" + per-source coverage |  | On handoff/e-analytics, R approved; branch merges as a unit after the F20/F11/F28 fixes (docs/review-probes/e-batch-review.md) |
| F30 | P1 | D/E | done | UI fetches check `res.ok` and handle `ApiErrorBody`; consume `@/lib/api-types` instead of local shapes (AddressDrawer, HeatmapMap, StreetSearch, compare) | b6400f1, cab4487 | R approved |
| F31 | P1 | E | review | District MoM card shows "för få affärer" when `pctChange` is null (use `currentCount`/`previousCount`) |  | On handoff/e-analytics, R approved; branch merges as a unit after the F20/F11/F28 fixes (docs/review-probes/e-batch-review.md) |
| F19 | P1 | E/D | todo | error.tsx per segment, inline retry (drawer, map, search), loading.tsx for insights/compare/house | | |
| F26 | P1 | E | done | Unknown district/street/house responds HTTP 404 (not a streamed 200); flip the pinned e2e test | 23a5ba3 | R approved. Layout-level validation + `(overview)` route group + `resolveStreet.ts` cache(). Nit: house page still runs its queries on 404 (→ B22) |
| F20 | P2 | D | in-progress | Mobile layout for `/` (bottom sheet/drawer below md; mobile nav) | 28003a6, 79d90e9, 95658e9 | D part merged. E fix 1f957f7 approved by fresh R: 26 nav tests plus independent desktop/mobile keyboard probes; reverting production reproduced 6 failures. Awaiting E stack merge; same-route selection minor tracked in F21. |
| F21 | P2 | D/E | in-progress | aria-pressed toggles, drawer focus trap/return/aria-modal, StreetSearch combobox, SVG icon, contrast | 25810ae, , abcda9d | D modal-stack part merged. E charts/tables/header still open; F37 follow-ups. Fresh F20 review minor: selecting current street from mobile search must close menu explicitly even when pathname unchanged; preserve menu on cancellation. Probe /tmp/review-e-f20-r1-probes.spec.ts. |
| F22 | P2 | E | todo | One chart colour token source; colour-blind-safe district colours, identical everywhere | | |
| F23 | P2 | E | todo | Per-page metadata, OG defaults, `metadataBase`, `/insights` in sitemap | | |
| F27 | P2 | E | review | Recent-sales table doesn't clip horizontally on mobile (scroll container or stacked rows) |  | On handoff/e-analytics, R approved; branch merges as a unit after the F20/F11/F28 fixes (docs/review-probes/e-batch-review.md) |
| F28 | P2 | E | review | Recharts `ResponsiveContainer` SSR warnings ("width(-1) and height(-1)") gone from server logs (initialDimension/minHeight) in PriceChart, Histogram, PriceAreaScatter | 64c50bf (review) | Overflow fix has full gate339 web/238 e2e/410 pytest;12 no-JS320px regression cases pass. Fresh review pending. Source handoff/e-analytics. |
| F29 | P2 | E | review | Insights subtitle "Allt räknas i SQL — inga sammanfattningar i frontend" is developer copy; rewrite for end users (Swedish) |  | On handoff/e-analytics, R approved (in same commit as F28) |
| F32 | P1 | E | review | No horizontal page overflow on mobile secondary pages (footer nav `flex-wrap`); e2e asserts `scrollWidth <= clientWidth` at Pixel 7 |  | On handoff/e-analytics, R approved; branch merges as a unit after the F20/F11/F28 fixes (docs/review-probes/e-batch-review.md) |
| F34 | P2 | D | review | Singular/plural copy ("1 försäljning") | ee437af | On handoff/e-analytics, R approved; branch merges as a unit after the F20/F11/F28 fixes (docs/review-probes/e-batch-review.md) |
| F35 | P1 | E | todo | Insights movers card/subtitle match B26 (90 d vs prior 12 mo, medians, recent/prior n) |  | Pending B26 on main (E skipped as instructed) |
| F36 | P2 | D | todo | Landscape-phone layout below md (map 110px / sidebar 81px at 568×320); search dialog fits short viewports / soft keyboard | | From R review of F20/F21 |
| F37 | P2 | D | todo | Modals below the top one get `inert`; drawer restores focus only if on top; search results keep real links (open in new tab); IME composition guard | | From R review of F21 |
| F38 | P2 | D | todo | Tied price breaks spread over [q05,q95] not min..max (outlier stretch); diacritic-insensitive district params | | From R review of F17 nits |
| F40 | P1 | D | todo | AddressDrawer preserves every same-day address sale as a separate plotted observation instead of overwriting by soldAt | | Orchestrator inspection: AddressDrawer merged map assigns existing.sale for each same-day row, losing prior prices. Prove with two different prices on one date. |
| F39 | P3 | E | todo | PriceAreaScatter median/n-awareness; SummaryCards grid empty cell at lg | | From E |
| F24 | P3 | D | todo | Hex click → sales list; shared-coordinate popups list all sales | | |
| F25 | P3 | E | todo | Optional dark mode via F22 tokens | | |

## Owner decisions

- **Mapbox geocoding storage terms (B16 d):** BLOCKED: needs owner decision. The scraper caches Mapbox results permanently in `Listing.lat/lng`. Mapbox's temporary geocoding API does not allow permanent storage on most plans. Recommendation: check your plan; if storage isn't covered, switch `geocode.py` to the permanent endpoint (`mapbox.places-permanent`, paid) or a self-hosted geocoder (e.g. Nominatim/Pelias with OSM data, attribution required). Inline coordinates from Hemnet/Booli make this matter only for the minority of rows without them.

(BLOCKED items get a one-paragraph recommendation here.)

- **Legacy 0-price rows (from B4):** not blocking. The dev DB currently has no tables, so there is nothing to clean. If an older DB with data is ever migrated, run `scraper reparse --dry-run` (read-only) first and decide by hand whether to delete the rows it reports as unparseable.

## Schema requests (B → C)

| Request | For | Status |
|---|---|---|
| `Listing.lastSeenAt` | B9 | migration done by C (d82bd17, in review); Python half → B |
