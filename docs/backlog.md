# Backlog ledger

Single source of truth for the hardening loop. A resumed session told "continue from docs/backlog.md" should read **Orchestration state** first and then pick up the next `todo` / `in-progress` rows.

## Orchestration state

- **Current phase:** Phase 2 (P1) in progress; Phase 1 P0 all done. Running: B (B16/B18 review fixes; next B46 refresh wiring), C (rebase + B21/B25/B26 review fixes), E (F32, F20-E, F34-E, F13-UI, F31, B14-UI, F8, F10, F11, F12, F18, F28, F29, F35). D idle (next: F36–F38, B23 adoption, B25 truncated hint). MERGE ORDER: B series (B43, B18, B16, B46) → C series (B13…B23, B21 last after B46).
- **Gate:** `scripts/check.sh` (typecheck, lint with zero warnings, vitest unit + integration, production build, Playwright e2e desktop + mobile, ruff, pytest). Must be green after every merge to `main`.
- **Process:** implementer agents (B scraper, C data/API, D map UI, E analytics UI) work in their own git worktrees, at most 3 at a time, one commit per backlog ID. A fresh reviewer (R) checks each task's diff and proving test. Only the orchestrator merges into `main`, one task at a time, re-running the gate after each merge. **Only the orchestrator edits this file**, so it never conflicts across worktrees; agents report status back to it.
- **Per-worktree isolation:** each role uses its own test DB and e2e port: B → `TEST_DB_NAME=bostadspriser_test_b E2E_PORT=3102`, C → `_c`/3103, D → `_d`/3104, E → `_e`/3105, orchestrator on `main` → `bostadspriser_test` (default)/3100. Never the dev DB `bostadspriser`.
- **Known-failing pins:** baseline bugs with a reproducing e2e test are marked `test.fail(...)` (or in `KNOWN_CONSOLE_ERRORS`) in `web/e2e/` with their ID. The fixing commit flips them to normal tests.
- **Platform gotchas fixed on main:** hidden `.pth` files on macOS/Python 3.13 (pytest `pythonpath`, check.sh `chflags`); stale `.next/types` after route moves (check.sh drops them).
- **Worktree note:** agent worktrees start from the initial commit; implementers fast-forward to `main` first (they did so in P1). Worktrees live in `.claude/worktrees/` (gitignored).
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
| B46 | P1 | B | in-progress | Scraper calls `refresh_deduped_listing()` after every writing command (guarded until the function exists), `refresh-view` command, mat-vs-live count check in `stats` |  | B 60e5a39: R changes requested (test drops the real function; stats test order-dependent) → B fixing. 67349c5 approved, waits. MERGE GATE for B21 |
| B47 | P3 | B | todo | Parser: floor marker after a range letter (`2-3B tr`, `2-3 t r`) | | From R review of B2 |
| B48 | P2 | B | done | Geocode exit codes: 75 rate-limited/unavailable, 78 bad token, 1 internal, 0 ok |  | R approved; 75 rate-limited/unavailable, 78 bad token, 1 internal, 0 ok |
| B13 | P1 | C+B | in-progress | Fuzzy cross-source matcher (same street+house, \ | ae5be64, 0d3c916 | Schema + canonical-key view merged (R approved). Matcher → B (now unblocked) |  | Schema (C) first |
| B14 | P1 | B+C | in-progress | Ingest sanity bounds (area 10–400, kr/m² 20k–400k, rooms 1–15) reject + count; SQL exposes median + count everywhere; UI defaults to median | 272f279, 6435fe3 | SQL merged (R approved); ingest bounds → B; UI default median → E (in progress) |
| B15 | P1 | B | todo | Check SaleCard for an area/location name and filter on it, or record that none exists | | |
| B16 | P1 | B(+C) | in-progress | Geocode: status/retry column, 429 backoff, display-name query, inner-Stockholm bbox + reject outside; (d) storage terms | a9ca105, 2e3669e, , 5b3428b,  | R approved through review 3. Remaining minors (starvation by persistently-5xx rows, reduced-budget charging, documented bound) → B. Mapbox storage terms → owner decision |
| B17 | P1 | B | done | Shared browser/source base; sources only define URL, `_looks_real`, extraction, `_to_row`; characterisation tests first | cdc61ba, 930c658 | R approved; guardrail diff byte-identical; shared core in source_base.py |
| B18 | P1 | C+B | in-progress | `ScrapeRun` model (C); scraper writes it and uses `logging` (B); web shows freshness (F18) | 4893c3c, 1457ded, ad0f8ab, 15c9b9a | Scraper side done (R approved). Remaining: UI F18 → E |
| B19 | P1 | B | done | Oldest-covered date per source/district; `scraper backfill --source --district --since --resume` | 1457ded | R approved (backfill --resume) |
| B20 | P1 | B | done | Batched upserts (page or 100 rows per transaction) | 5516ecc, a1fc82e | R approved |
| B21 | P2 | C | in-progress | Measure ~200k rows + EXPLAIN ANALYZE into docs/perf.md; materialized view or `isCanonical`; re-measure |  | C: materialized view DedupedListingMat, before/after in docs/perf.md (queries 0.9–2.3s → ≤175ms at 200k rows). R: approved design; MERGE GATE: B adds guarded refresh_deduped_listing() calls first, then C B21 merges. C adding lock_timeout + test statement_timeout |
| B22 | P2 | C+B | todo | Persisted `streetSlug` + index, shared slug vectors, React `cache()` on lookups | | Depends on B23. `streetFromSlug` scans all district streets; E added `resolveStreet.ts` cache() wrapper in F26 |
| B23 | P2 | C(+B,D,E) | in-progress | One slug/fold implementation in `web/src/lib/text.ts`; `shared/slug-vectors.json` asserted by pytest and vitest |  | C b241ee5 R approved (lib/text.ts + shared/slug-vectors.json, URLs unchanged). Remaining: pytest vectors (B), StreetSearch/AddressDrawer adopt it (D) |
| B24 | P2 | C/E | review | `revalidate` or tag caching + secret `POST /api/revalidate`; build never needs a DB |  | Build part done in P0.2; C 733bbbf (tag-based unstable_cache + POST /api/revalidate) in review |
| B25 | P2 | C | review | Deliberate heatmap cap, minimal properties, bbox/zoom filtering, gzip; documented; response reports truncation |  | C 730b5f1 R approved (cap 30k + truncated flag); minors → C; UI hint → D later |
| B26 | P2 | C | in-progress | topMovers: disjoint windows, higher thresholds, medians, expose n |  | C 72f1716: R changes requested (doc semantics); insights copy → E (F35) |
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
| F8 | P1 | E | todo | Månad/År toggle on every time-series chart, in URL (`?g=year`), year buckets formatted `2025` | | |
| F9 | P1 | E | todo | Compare builder: add-series combobox (streets + districts), removable chips, "Jämför" buttons, dedupe, shared palette | | |
| F10 | P1 | E | todo | House page shows address vs street vs district | | |
| F11 | P1 | E/D | todo | Numeric time axis with honest gaps (PriceChart E, AddressDrawer D) | | |
| F12 | P1 | E/D | todo | Tooltips show n; buckets with n < 3 de-emphasised | | |
| F13 | P1 | C+E | in-progress | SQL `streetSummary` / `addressSummary` / `districtStreetCount`; correct labelled stats | 48d7aa0 | SQL side merged; UI wiring → E |
| F14 | P1 | C | done | House numbers sort naturally in SQL | a5b5813, 1ced813 | R approved |
| F15 | P1 | D | done | Map filters round-trip through searchParams | 120347d, 7869c5a, 4efd397 | R approved; server-rendered from searchParams |
| F16 | P1 | E(+C) | todo | Room/size segmentation chips on district + street pages | | |
| F17 | P1 | D(+C) | done | Data-driven quantile price legend; ramp + legend in one module | 2de7d86, 2aa4c76, 4efd397 | R approved; outlier-stretch follow-up in F38 |
| F18 | P1 | E | todo | "Senast uppdaterad …" + per-source coverage | | Depends on B18 |
| F30 | P1 | D/E | done | UI fetches check `res.ok` and handle `ApiErrorBody`; consume `@/lib/api-types` instead of local shapes (AddressDrawer, HeatmapMap, StreetSearch, compare) | b6400f1, cab4487 | R approved |
| F31 | P1 | E | todo | District MoM card shows "för få affärer" when `pctChange` is null (use `currentCount`/`previousCount`) |  | From C B7 + R: hide "prev → cur" hint or show months/counts when pctChange is null |
| F19 | P1 | E/D | todo | error.tsx per segment, inline retry (drawer, map, search), loading.tsx for insights/compare/house | | |
| F26 | P1 | E | done | Unknown district/street/house responds HTTP 404 (not a streamed 200); flip the pinned e2e test | 23a5ba3 | R approved. Layout-level validation + `(overview)` route group + `resolveStreet.ts` cache(). Nit: house page still runs its queries on 404 (→ B22) |
| F20 | P2 | D | in-progress | Mobile layout for `/` (bottom sheet/drawer below md; mobile nav) | 28003a6, 79d90e9, 95658e9 | D part merged (R approved at 320–915px). Remaining: SiteHeader mobile nav (E), landscape-phone layout (F36) |
| F21 | P2 | D/E | in-progress | aria-pressed toggles, drawer focus trap/return/aria-modal, StreetSearch combobox, SVG icon, contrast | 25810ae, , abcda9d | D part merged (modal stack). Remaining: E part (charts/tables/header), follow-ups F37 |
| F22 | P2 | E | todo | One chart colour token source; colour-blind-safe district colours, identical everywhere | | |
| F23 | P2 | E | todo | Per-page metadata, OG defaults, `metadataBase`, `/insights` in sitemap | | |
| F27 | P2 | E | todo | Recent-sales table doesn't clip horizontally on mobile (scroll container or stacked rows) | | Found in P0 screenshot of /district/ostermalm at Pixel 7 width |
| F28 | P2 | E | todo | Recharts `ResponsiveContainer` SSR warnings ("width(-1) and height(-1)") gone from server logs (initialDimension/minHeight) in PriceChart, Histogram, PriceAreaScatter | | From E (P1 run) |
| F29 | P2 | E | todo | Insights subtitle "Allt räknas i SQL — inga sammanfattningar i frontend" is developer copy; rewrite for end users (Swedish) | | From E (P1 run) |
| F32 | P1 | E | todo | No horizontal page overflow on mobile secondary pages (footer nav `flex-wrap`); e2e asserts `scrollWidth <= clientWidth` at Pixel 7 | | From R review of F1 |
| F34 | P2 | D | in-progress | Singular/plural copy ("1 försäljning") | ee437af | D part done; E files (district/street/insights/Histogram) → E |
| F35 | P1 | E | in-progress | Insights movers card/subtitle match B26 (90 d vs prior 12 mo, medians, recent/prior n) | | From R review of B26 |
| F36 | P2 | D | todo | Landscape-phone layout below md (map 110px / sidebar 81px at 568×320); search dialog fits short viewports / soft keyboard | | From R review of F20/F21 |
| F37 | P2 | D | todo | Modals below the top one get `inert`; drawer restores focus only if on top; search results keep real links (open in new tab); IME composition guard | | From R review of F21 |
| F38 | P2 | D | todo | Tied price breaks spread over [q05,q95] not min..max (outlier stretch); diacritic-insensitive district params | | From R review of F17 nits |
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
