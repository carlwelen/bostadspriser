# Backlog ledger

Single source of truth for the hardening loop. A resumed session told "continue from docs/backlog.md" should read **Orchestration state** first and then pick up the next `todo` / `in-progress` rows.

## Orchestration state

- **Current phase:** Phase 1 nearly done (open P0: B6/B5/B30/B7/B8/B9 on C branch, F6 fix). Phase 2 under way. Running: B (follow-ups, B9-py, B20, B39, B17), C (B27/B6 fixes, B38, B18/B16/B13 schema, B14 SQL), D (F6 fix, nits, F33, F15, F17). E idle → next free slot (F8, F10, F11, F12, F13-UI, F16, F18, F31, F32). Merge order: C series next (D F30 already in), then B9-python.
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
| B2 | P0 | B | done | One `parse_street_address()` in normalize.py used by both sources; table test incl. `S:t Eriksgatan`, `Karlavägen 1 A`, `Ringvägen 12-14`, `Hornsgatan 64 1tr`, `Odengatan 5, lgh 1101` | 0d23680, b7021d5, f3585e9 | R approved; follow-up (floor-after-dash ranges, digit-in-street guard, ASCII digits) → B |
| B3 | P0 | B | done | `scraper reparse [--dry-run]` re-derives street/house/rooms/area/prices/dedupKey from `raw`, batched, idempotent; backfill batched too | 70678c0, fc0cec9 | R approved after review fix (soldAt re-derived, round_1dp, FOR UPDATE) |
| B4 | P0 | B | done | Rows without a final price are skipped (no `0` prices / `::0` dedup keys); Hemnet derives kr/m² from price/area when missing | 71528f6 | R approved |
| B5 | P0 | C | review | `rooms=5` on /api/heatmap means `>= 5` ("5+"); integration test with a 6-room row |  | R approved incl. fix 7d43609; merges with the C series after D F30 |
| B6 | P0 | C | in-progress | Every API route validates params (400 + JSON error on bad/negative/huge input); DB errors → 500 JSON + server log; tests per bad input |  | R approved + fix 53a285f; MoM test still vacuous → C fixing (B6 review 2). Merge after D F30 |
| B7 | P0 | C | review | MoM uses the last two complete, adjacent months; `null` when either has < N sales |  | R approved; merges with the C series |
| B8 | P0 | C | review | `/api/address` applies the period to `addressSales` |  | R approved; merges with the C series |
| B9 | P0 | C→B | in-progress | Prisma migration adds `lastSeenAt` (C); scraper sets it on every upsert and the view tie-breaks on it (B) |  | Schema half d82bd17 R approved. Python half blocked until C series merges (B stopped as instructed) |
| B10 | P0 | B | done | Upsert keeps existing lat/lng/geocodedAt when incoming coords are NULL (DB test) | 07ba608 | R approved |
| B11 | P0 | B | done | probe scripts fixed or deleted; nothing imports `DISTRICT_URLS` | 7bb57d6 | R approved; probe scripts deleted |
| B12 | P0 | B | done | `update` exits non-zero if any source/district fails and prints a summary table | fff39cc | R approved |
| B30 | P0 | C | review | `isDistrictSlug` rejects prototype keys (`toString`, `constructor`, `__proto__`); unit test |  | R approved; merges with the C series |
| B31 | P1 | B | done | `db.engine()` pins session `timezone=UTC` so `timestamp(3)` columns don't depend on server TimeZone; test | 0f56124 | R approved; follow-up (reset TZ in session fixture) → B |
| B32 | P1 | B | done | Source iterators signal an incomplete crawl (page fetch failed mid-pagination) so `update` reports `partial` and exits non-zero | b3355d4 | R approved; follow-up (stale comments, failed-when-0-rows) → B |
| B33 | P3 | B | in-progress | Unify Hemnet/Booli geocodedAt stamping (`is not None`) |  | Folded into B17 |
| B34 | P1 | C | review | `sinceDays`/period cut-offs (heatmap, address, topMovers) use Stockholm's current date explicitly, not the session `CURRENT_DATE` |  | C e58b1f4, R approved |
| B35 | P0 | B | done | Pagination doesn't stop on a page whose cards were all skipped (only on soldAt < since / empty page / no parseable date ≥ since); test both sources | 0687c0c | R approved |
| B36 | P2 | B | todo | Reviewed purge/flag for legacy rows reparse reports unparseable (e.g. `reparse --prune-unparseable`) | | From R review of B4 |
| B37 | P0 | B | done | Crawl stops on a repeated page (same card ids) and at a hard MAX_PAGES cap; runaway test guard can't be swallowed | 9a8c918 | R approved; follow-up (crawl-wide seen set, id-less fingerprint, log/flag stop) → B |
| B38 | P1 | C | in-progress | DedupedListing prefers priced rows (`pricePerSqmSek > 0`) before other tie-breakers | | From R review of C (pre-existing) |
| B39 | P1 | B | in-progress | A partial crawl must not advance the `update` cutoff (no permanent gap in the failed tail) | | From R review of B32 |
| F33 | P1 | D | in-progress | Drawer never shows the previous address's data while a new one loads; "Försök igen" after error | | From R review of F30 |
| B13 | P1 | C+B | in-progress | Fuzzy cross-source matcher (same street+house, \ | Δdate\ | Schema clusterId + view grouping → C in progress; matcher → B later |  | Schema (C) first |
| B14 | P1 | B+C | in-progress | Ingest sanity bounds (area 10–400, kr/m² 20k–400k, rooms 1–15) reject + count; SQL exposes median + count everywhere; UI defaults to median |  | SQL median everywhere → C in progress; ingest bounds → B later; UI default median → E later |
| B15 | P1 | B | todo | Check SaleCard for an area/location name and filter on it, or record that none exists | | |
| B16 | P1 | B(+C) | in-progress | Geocode: status/retry column, 429 backoff, display-name query, inner-Stockholm bbox + reject outside; (d) storage terms |  | Schema (geocodeStatus, geocodeAttempts) → C in progress; scraper logic → B later |
| B17 | P1 | B | in-progress | Shared browser/source base; sources only define URL, `_looks_real`, extraction, `_to_row`; characterisation tests first |  | B; folds in B33 + max-pages guard |
| B18 | P1 | C+B | in-progress | `ScrapeRun` model (C); scraper writes it and uses `logging` (B); web shows freshness (F18) |  | Schema + freshness query → C (in progress); scraper writes rows → B later; UI F18 → E |
| B19 | P1 | B | todo | Oldest-covered date per source/district; `scraper backfill --source --district --since --resume` | | Depends on B18 |
| B20 | P1 | B | in-progress | Batched upserts (page or 100 rows per transaction) |  | B |
| B21 | P2 | C | todo | Measure ~200k rows + EXPLAIN ANALYZE into docs/perf.md; materialized view or `isCanonical`; re-measure | | |
| B22 | P2 | C+B | todo | Persisted `streetSlug` + index, shared slug vectors, React `cache()` on lookups | | Depends on B23. `streetFromSlug` scans all district streets; E added `resolveStreet.ts` cache() wrapper in F26 |
| B23 | P2 | C(+B,D,E) | todo | One slug/fold implementation in `web/src/lib/text.ts`; `shared/slug-vectors.json` asserted by pytest and vitest | | |
| B24 | P2 | C/E | todo | `revalidate` or tag caching + secret `POST /api/revalidate`; build never needs a DB | | Build part done in P0.2 |
| B25 | P2 | C | todo | Deliberate heatmap cap, minimal properties, bbox/zoom filtering, gzip; documented; response reports truncation | | |
| B26 | P2 | C | todo | topMovers: disjoint windows, higher thresholds, medians, expose n | | |
| B27 | P2 | C | in-progress | Inline SQL in /api/address, /api/heatmap, /api/streets/all moved to aggregations.ts |  | C 0fdfa0b: R blocker (snapshots decay with the calendar) → C pinning the clock |
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
| F6 | P0 | D | in-progress | Missing Mapbox token → clear in-app message; remove the F6 entry from `KNOWN_CONSOLE_ERRORS` |  | R: changes requested (alert clipped at mobile width) → D fixing |
| F7 | P0 | E/D | in-progress | Copy reflects Booli + selected period; footer uses `DISTRICTS` display names | 384d821 | E part 384d821 done; D sidebar a9d5265 R approved, merges after F6 fix |
| F8 | P1 | E | todo | Månad/År toggle on every time-series chart, in URL (`?g=year`), year buckets formatted `2025` | | |
| F9 | P1 | E | todo | Compare builder: add-series combobox (streets + districts), removable chips, "Jämför" buttons, dedupe, shared palette | | |
| F10 | P1 | E | todo | House page shows address vs street vs district | | |
| F11 | P1 | E/D | todo | Numeric time axis with honest gaps (PriceChart E, AddressDrawer D) | | |
| F12 | P1 | E/D | todo | Tooltips show n; buckets with n < 3 de-emphasised | | |
| F13 | P1 | C+E | in-progress | SQL `streetSummary` / `addressSummary` / `districtStreetCount`; correct labelled stats |  | SQL side C 773f61a R approved; UI wiring → E |
| F14 | P1 | C | review | House numbers sort naturally in SQL |  | C ef6ae1b, R approved |
| F15 | P1 | D | in-progress | Map filters round-trip through searchParams |  | D |
| F16 | P1 | E(+C) | todo | Room/size segmentation chips on district + street pages | | |
| F17 | P1 | D(+C) | in-progress | Data-driven quantile price legend; ramp + legend in one module |  | D |
| F18 | P1 | E | todo | "Senast uppdaterad …" + per-source coverage | | Depends on B18 |
| F30 | P1 | D/E | in-progress | UI fetches check `res.ok` and handle `ApiErrorBody`; consume `@/lib/api-types` instead of local shapes (AddressDrawer, HeatmapMap, StreetSearch, compare) | b6400f1 | D part merged (R approved). Remaining: consume `@/lib/api-types` once C series lands (TODO(F30) comments) |
| F31 | P1 | E | todo | District MoM card shows "för få affärer" when `pctChange` is null (use `currentCount`/`previousCount`) |  | From C B7 + R: hide "prev → cur" hint or show months/counts when pctChange is null |
| F19 | P1 | E/D | todo | error.tsx per segment, inline retry (drawer, map, search), loading.tsx for insights/compare/house | | |
| F26 | P1 | E | done | Unknown district/street/house responds HTTP 404 (not a streamed 200); flip the pinned e2e test | 23a5ba3 | R approved. Layout-level validation + `(overview)` route group + `resolveStreet.ts` cache(). Nit: house page still runs its queries on 404 (→ B22) |
| F20 | P2 | D | todo | Mobile layout for `/` (bottom sheet/drawer below md; mobile nav) | | |
| F21 | P2 | D/E | todo | aria-pressed toggles, drawer focus trap/return/aria-modal, StreetSearch combobox, SVG icon, contrast |  | + StreetSearch modal should lock body scroll (R review of F1) |
| F22 | P2 | E | todo | One chart colour token source; colour-blind-safe district colours, identical everywhere | | |
| F23 | P2 | E | todo | Per-page metadata, OG defaults, `metadataBase`, `/insights` in sitemap | | |
| F27 | P2 | E | todo | Recent-sales table doesn't clip horizontally on mobile (scroll container or stacked rows) | | Found in P0 screenshot of /district/ostermalm at Pixel 7 width |
| F28 | P2 | E | todo | Recharts `ResponsiveContainer` SSR warnings ("width(-1) and height(-1)") gone from server logs (initialDimension/minHeight) in PriceChart, Histogram, PriceAreaScatter | | From E (P1 run) |
| F29 | P2 | E | todo | Insights subtitle "Allt räknas i SQL — inga sammanfattningar i frontend" is developer copy; rewrite for end users (Swedish) | | From E (P1 run) |
| F32 | P1 | E | todo | No horizontal page overflow on mobile secondary pages (footer nav `flex-wrap`); e2e asserts `scrollWidth <= clientWidth` at Pixel 7 | | From R review of F1 |
| F24 | P3 | D | todo | Hex click → sales list; shared-coordinate popups list all sales | | |
| F25 | P3 | E | todo | Optional dark mode via F22 tokens | | |

## Owner decisions

(BLOCKED items get a one-paragraph recommendation here.)

- **Legacy 0-price rows (from B4):** not blocking. The dev DB currently has no tables, so there is nothing to clean. If an older DB with data is ever migrated, run `scraper reparse --dry-run` (read-only) first and decide by hand whether to delete the rows it reports as unparseable.

## Schema requests (B → C)

| Request | For | Status |
|---|---|---|
| `Listing.lastSeenAt` | B9 | migration done by C (d82bd17, in review); Python half → B |
