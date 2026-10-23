# Backlog ledger

Single source of truth for the hardening loop. A resumed session told "continue from docs/backlog.md" should read **Orchestration state** first and then pick up the next `todo` / `in-progress` rows.

## Orchestration state

- **Current phase:** Phase 1 (P0). Running: B (B1,B2,B3,B4,B10,B12,B11), C (B30,B6,B5,B8,B7,B9-schema), E (F1,F4,F26,F7-footer). Queued: D (F3,F2,F5,F6,F7-sidebar), then B9-python.
- **Gate:** `scripts/check.sh` (typecheck, lint with zero warnings, vitest unit + integration, production build, Playwright e2e desktop + mobile, ruff, pytest). Must be green after every merge to `main`.
- **Process:** implementer agents (B scraper, C data/API, D map UI, E analytics UI) work in their own git worktrees, at most 3 at a time, one commit per backlog ID. A fresh reviewer (R) checks each task's diff and proving test. Only the orchestrator merges into `main`, one task at a time, re-running the gate after each merge. **Only the orchestrator edits this file**, so it never conflicts across worktrees; agents report status back to it.
- **Per-worktree isolation:** each role uses its own test DB and e2e port: B → `TEST_DB_NAME=bostadspriser_test_b E2E_PORT=3102`, C → `_c`/3103, D → `_d`/3104, E → `_e`/3105, orchestrator on `main` → `bostadspriser_test` (default)/3100. Never the dev DB `bostadspriser`.
- **Known-failing pins:** baseline bugs with a reproducing e2e test are marked `test.fail(...)` (or in `KNOWN_CONSOLE_ERRORS`) in `web/e2e/` with their ID. The fixing commit flips them to normal tests.
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
| B1 | P0 | B | review | `scraper update` MAX(soldAt) query works (no `:d::` bind bug); DB test covers it | | |
| B2 | P0 | B | review | One `parse_street_address()` in normalize.py used by both sources; table test incl. `S:t Eriksgatan`, `Karlavägen 1 A`, `Ringvägen 12-14`, `Hornsgatan 64 1tr`, `Odengatan 5, lgh 1101` | | |
| B3 | P0 | B | review | `scraper reparse [--dry-run]` re-derives street/house/rooms/area/prices/dedupKey from `raw`, batched, idempotent; backfill batched too | | Depends on B2 |
| B4 | P0 | B | review | Rows without a final price are skipped (no `0` prices / `::0` dedup keys); Hemnet derives kr/m² from price/area when missing | | Decision: skip, don't make columns nullable |
| B5 | P0 | C | in-progress | `rooms=5` on /api/heatmap means `>= 5` ("5+"); integration test with a 6-room row | | |
| B6 | P0 | C | in-progress | Every API route validates params (400 + JSON error on bad/negative/huge input); DB errors → 500 JSON + server log; tests per bad input | | |
| B7 | P0 | C | in-progress | MoM uses the last two complete, adjacent months; `null` when either has < N sales | | |
| B8 | P0 | C | in-progress | `/api/address` applies the period to `addressSales` | | |
| B9 | P0 | C→B | in-progress | Prisma migration adds `lastSeenAt` (C); scraper sets it on every upsert and the view tie-breaks on it (B) | | Schema first (C), then Python (B) |
| B10 | P0 | B | review | Upsert keeps existing lat/lng/geocodedAt when incoming coords are NULL (DB test) | | |
| B11 | P0 | B | review | probe scripts fixed or deleted; nothing imports `DISTRICT_URLS` | | |
| B12 | P0 | B | review | `update` exits non-zero if any source/district fails and prints a summary table | | |
| B30 | P0 | C | in-progress | `isDistrictSlug` rejects prototype keys (`toString`, `constructor`, `__proto__`); unit test | | Found in Phase 0: `"toString" in SLUG_TO_NAME` is true, so it reaches the SQL enum cast → 500 |
| B31 | P1 | B | todo | `db.engine()` pins session `timezone=UTC` so `timestamp(3)` columns don't depend on server TimeZone; test | | From B (P1 run) |
| B32 | P1 | B | todo | Source iterators signal an incomplete crawl (page fetch failed mid-pagination) so `update` reports `partial` and exits non-zero | | From B (P1 run); overlaps B17/B18 |
| B33 | P3 | B | todo | Unify Hemnet/Booli geocodedAt stamping (`is not None`) | | From B (P1 run); fold into B17 |
| B13 | P1 | C+B | todo | Fuzzy cross-source matcher (same street+house, \|Δdate\| ≤ 3 d, price ±0.5%) assigns a cluster id; view groups on it; paired-fixture tests | | Schema (C) first |
| B14 | P1 | B+C | todo | Ingest sanity bounds (area 10–400, kr/m² 20k–400k, rooms 1–15) reject + count; SQL exposes median + count everywhere; UI defaults to median | | |
| B15 | P1 | B | todo | Check SaleCard for an area/location name and filter on it, or record that none exists | | |
| B16 | P1 | B(+C) | todo | Geocode: status/retry column, 429 backoff, display-name query, inner-Stockholm bbox + reject outside; (d) storage terms | | (d) likely owner decision; schema via C |
| B17 | P1 | B | todo | Shared browser/source base; sources only define URL, `_looks_real`, extraction, `_to_row`; characterisation tests first | | |
| B18 | P1 | C+B | todo | `ScrapeRun` model (C); scraper writes it and uses `logging` (B); web shows freshness (F18) | | |
| B19 | P1 | B | todo | Oldest-covered date per source/district; `scraper backfill --source --district --since --resume` | | Depends on B18 |
| B20 | P1 | B | todo | Batched upserts (page or 100 rows per transaction) | | |
| B21 | P2 | C | todo | Measure ~200k rows + EXPLAIN ANALYZE into docs/perf.md; materialized view or `isCanonical`; re-measure | | |
| B22 | P2 | C+B | todo | Persisted `streetSlug` + index, shared slug vectors, React `cache()` on lookups | | Depends on B23 |
| B23 | P2 | C(+B,D,E) | todo | One slug/fold implementation in `web/src/lib/text.ts`; `shared/slug-vectors.json` asserted by pytest and vitest | | |
| B24 | P2 | C/E | todo | `revalidate` or tag caching + secret `POST /api/revalidate`; build never needs a DB | | Build part done in P0.2 |
| B25 | P2 | C | todo | Deliberate heatmap cap, minimal properties, bbox/zoom filtering, gzip; documented | | |
| B26 | P2 | C | todo | topMovers: disjoint windows, higher thresholds, medians, expose n | | |
| B27 | P2 | C | todo | Inline SQL in /api/address, /api/heatmap, /api/streets/all moved to aggregations.ts | | |
| B28 | P3 | C | todo | PostGIS only if B21/B25 measurements justify it | | |
| B29 | P3 | A/B | todo | Dockerfile + cron/systemd example for `update && geocode`, with lockfile | | |

## Frontend

| ID | P | Owner | Status | Acceptance | Commit | Notes |
|---|---|---|---|---|---|---|
| F1 | P0 | E | review | Secondary pages scroll with real input; full-height/overflow lives in the map page wrapper | | Confirmed in P0: e2e "scrolls to the footer" pinned `test.fail` |
| F2 | P0 | D | todo | Deselecting every district shows the empty state (or the last can't be deselected), consistently | | |
| F3 | P0 | D | todo | Map popups never inject scraped strings as HTML; test with a malicious address | | |
| F4 | P0 | E | review | `<html lang="sv">` | | |
| F5 | P0 | D | todo | Hex layer handlers registered once (no pile-up across mode switches) | | |
| F6 | P0 | D | todo | Missing Mapbox token → clear in-app message; remove the F6 entry from `KNOWN_CONSOLE_ERRORS` | | |
| F7 | P0 | E/D | in-progress | Copy reflects Booli + selected period; footer uses `DISTRICTS` display names | | Sidebar copy lives in page.tsx (D) |
| F8 | P1 | E | todo | Månad/År toggle on every time-series chart, in URL (`?g=year`), year buckets formatted `2025` | | |
| F9 | P1 | E | todo | Compare builder: add-series combobox (streets + districts), removable chips, "Jämför" buttons, dedupe, shared palette | | |
| F10 | P1 | E | todo | House page shows address vs street vs district | | |
| F11 | P1 | E/D | todo | Numeric time axis with honest gaps (PriceChart E, AddressDrawer D) | | |
| F12 | P1 | E/D | todo | Tooltips show n; buckets with n < 3 de-emphasised | | |
| F13 | P1 | C+E | todo | SQL `streetSummary` / `addressSummary` / `districtStreetCount`; correct labelled stats | | |
| F14 | P1 | C | todo | House numbers sort naturally in SQL | | |
| F15 | P1 | D | todo | Map filters round-trip through searchParams | | |
| F16 | P1 | E(+C) | todo | Room/size segmentation chips on district + street pages | | |
| F17 | P1 | D(+C) | todo | Data-driven quantile price legend; ramp + legend in one module | | |
| F18 | P1 | E | todo | "Senast uppdaterad …" + per-source coverage | | Depends on B18 |
| F19 | P1 | E/D | todo | error.tsx per segment, inline retry (drawer, map, search), loading.tsx for insights/compare/house | | |
| F26 | P1 | E | review | Unknown district/street/house responds HTTP 404 (not a streamed 200); flip the pinned e2e test | | Found in P0: `district/[slug]/loading.tsx` starts streaming before `notFound()`. E commit 9e6f889 under review |
| F20 | P2 | D | todo | Mobile layout for `/` (bottom sheet/drawer below md; mobile nav) | | |
| F21 | P2 | D/E | todo | aria-pressed toggles, drawer focus trap/return/aria-modal, StreetSearch combobox, SVG icon, contrast | | |
| F22 | P2 | E | todo | One chart colour token source; colour-blind-safe district colours, identical everywhere | | |
| F23 | P2 | E | todo | Per-page metadata, OG defaults, `metadataBase`, `/insights` in sitemap | | |
| F27 | P2 | E | todo | Recent-sales table doesn't clip horizontally on mobile (scroll container or stacked rows) | | Found in P0 screenshot of /district/ostermalm at Pixel 7 width |
| F28 | P2 | E | todo | Recharts `ResponsiveContainer` SSR warnings ("width(-1) and height(-1)") gone from server logs (initialDimension/minHeight) in PriceChart, Histogram, PriceAreaScatter | | From E (P1 run) |
| F29 | P2 | E | todo | Insights subtitle "Allt räknas i SQL — inga sammanfattningar i frontend" is developer copy; rewrite for end users (Swedish) | | From E (P1 run) |
| F24 | P3 | D | todo | Hex click → sales list; shared-coordinate popups list all sales | | |
| F25 | P3 | E | todo | Optional dark mode via F22 tokens | | |

## Owner decisions

(BLOCKED items get a one-paragraph recommendation here.)

- **Legacy 0-price rows (from B4):** not blocking. The dev DB currently has no tables, so there is nothing to clean. If an older DB with data is ever migrated, run `scraper reparse --dry-run` (read-only) first and decide by hand whether to delete the rows it reports as unparseable.

## Schema requests (B → C)

| Request | For | Status |
|---|---|---|
| `Listing.lastSeenAt` | B9 | todo (C, Phase 1) |
