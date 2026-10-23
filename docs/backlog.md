# Backlog ledger

Single source of truth for the hardening loop. A resumed session told "continue from docs/backlog.md" should read **Orchestration state** first and then pick up the next `todo` / `in-progress` rows.

## Orchestration state

- **Current phase:** Phase 0 done → Phase 1 (P0) starting.
- **Gate:** `scripts/check.sh` (typecheck, lint with zero warnings, vitest unit + integration, production build, Playwright e2e desktop + mobile, ruff, pytest). Must be green after every merge to `main`.
- **Process:** implementer agents (B scraper, C data/API, D map UI, E analytics UI) work in their own git worktrees, at most 3 at a time, one commit per backlog ID. A fresh reviewer (R) checks each task's diff and proving test. Only the orchestrator merges into `main`, one task at a time, re-running the gate after each merge. **Only the orchestrator edits this file**, so it never conflicts across worktrees; agents report status back to it.
- **Per-worktree isolation:** each role uses its own test DB and e2e port: B → `TEST_DB_NAME=bostadspriser_test_b E2E_PORT=3102`, C → `_c`/3103, D → `_d`/3104, E → `_e`/3105, orchestrator on `main` → `bostadspriser_test` (default)/3100. Never the dev DB `bostadspriser`.
- **Known-failing pins:** baseline bugs with a reproducing e2e test are marked `test.fail(...)` (or in `KNOWN_CONSOLE_ERRORS`) in `web/e2e/` with their ID. The fixing commit flips them to normal tests.
- **Audit rounds completed:** 0 (stop condition needs two consecutive rounds with no new P0/P1).

Status values: `todo`, `in-progress`, `review`, `done`, `BLOCKED: needs owner decision`.
Owners: A platform, B scraper, C data/API, D map UI, E analytics UI.

## Phase 0: baseline

| ID | P | Owner | Status | Acceptance | Commit | Notes |
|---|---|---|---|---|---|---|
| P0.1 | - | A | done | Repo under git with an untouched baseline commit | 5cbdd95 | Repo was already initialised ("Initial commit") |
| P0.2 | - | A | done | pnpm install / prisma generate / tsc / lint / build / uv sync / pytest / ruff all green on macOS + Node 26 | be6641b | Dropped linux-only oxide binary; pnpm 12 `allowBuilds`; root `.env` loaded via `@next/env`; sitemap made dynamic (B24 build part) |
| P0.3 | - | A | done | Vitest unit + integration harness on a real test DB, Playwright e2e smoke, pytest `db` fixture, `scripts/check.sh` | (this commit) | See CLAUDE.md "Testing" |
| P0.4 | - | A | done | CLAUDE.md / README.md / agent memory paths match reality | (this commit) | |
| P0.5 | - | A | done | This ledger seeded with every item | (this commit) | |

## Backend / data

| ID | P | Owner | Status | Acceptance | Commit | Notes |
|---|---|---|---|---|---|---|
| B1 | P0 | B | todo | `scraper update` MAX(soldAt) query works (no `:d::` bind bug); DB test covers it | | |
| B2 | P0 | B | todo | One `parse_street_address()` in normalize.py used by both sources; table test incl. `S:t Eriksgatan`, `Karlavägen 1 A`, `Ringvägen 12-14`, `Hornsgatan 64 1tr`, `Odengatan 5, lgh 1101` | | |
| B3 | P0 | B | todo | `scraper reparse [--dry-run]` re-derives street/house/rooms/area/prices/dedupKey from `raw`, batched, idempotent; backfill batched too | | Depends on B2 |
| B4 | P0 | B | todo | Rows without a final price are skipped (no `0` prices / `::0` dedup keys); Hemnet derives kr/m² from price/area when missing | | Decision: skip, don't make columns nullable |
| B5 | P0 | C | todo | `rooms=5` on /api/heatmap means `>= 5` ("5+"); integration test with a 6-room row | | |
| B6 | P0 | C | todo | Every API route validates params (400 + JSON error on bad/negative/huge input); DB errors → 500 JSON + server log; tests per bad input | | |
| B7 | P0 | C | todo | MoM uses the last two complete, adjacent months; `null` when either has < N sales | | |
| B8 | P0 | C | todo | `/api/address` applies the period to `addressSales` | | |
| B9 | P0 | C→B | todo | Prisma migration adds `lastSeenAt` (C); scraper sets it on every upsert and the view tie-breaks on it (B) | | Schema first (C), then Python (B) |
| B10 | P0 | B | todo | Upsert keeps existing lat/lng/geocodedAt when incoming coords are NULL (DB test) | | |
| B11 | P0 | B | todo | probe scripts fixed or deleted; nothing imports `DISTRICT_URLS` | | |
| B12 | P0 | B | todo | `update` exits non-zero if any source/district fails and prints a summary table | | |
| B30 | P0 | C | todo | `isDistrictSlug` rejects prototype keys (`toString`, `constructor`, `__proto__`); unit test | | Found in Phase 0: `"toString" in SLUG_TO_NAME` is true, so it reaches the SQL enum cast → 500 |
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
| F1 | P0 | E | todo | Secondary pages scroll with real input; full-height/overflow lives in the map page wrapper | | Confirmed in P0: e2e "scrolls to the footer" pinned `test.fail` |
| F2 | P0 | D | todo | Deselecting every district shows the empty state (or the last can't be deselected), consistently | | |
| F3 | P0 | D | todo | Map popups never inject scraped strings as HTML; test with a malicious address | | |
| F4 | P0 | E | todo | `<html lang="sv">` | | |
| F5 | P0 | D | todo | Hex layer handlers registered once (no pile-up across mode switches) | | |
| F6 | P0 | D | todo | Missing Mapbox token → clear in-app message; remove the F6 entry from `KNOWN_CONSOLE_ERRORS` | | |
| F7 | P0 | E/D | todo | Copy reflects Booli + selected period; footer uses `DISTRICTS` display names | | Sidebar copy lives in page.tsx (D) |
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
| F26 | P1 | E | todo | Unknown district/street/house responds HTTP 404 (not a streamed 200); flip the pinned e2e test | | Found in P0: `district/[slug]/loading.tsx` starts streaming before `notFound()` |
| F20 | P2 | D | todo | Mobile layout for `/` (bottom sheet/drawer below md; mobile nav) | | |
| F21 | P2 | D/E | todo | aria-pressed toggles, drawer focus trap/return/aria-modal, StreetSearch combobox, SVG icon, contrast | | |
| F22 | P2 | E | todo | One chart colour token source; colour-blind-safe district colours, identical everywhere | | |
| F23 | P2 | E | todo | Per-page metadata, OG defaults, `metadataBase`, `/insights` in sitemap | | |
| F27 | P2 | E | todo | Recent-sales table doesn't clip horizontally on mobile (scroll container or stacked rows) | | Found in P0 screenshot of /district/ostermalm at Pixel 7 width |
| F24 | P3 | D | todo | Hex click → sales list; shared-coordinate popups list all sales | | |
| F25 | P3 | E | todo | Optional dark mode via F22 tokens | | |

## Owner decisions

(None recorded yet. BLOCKED items get a one-paragraph recommendation here.)

## Schema requests (B → C)

| Request | For | Status |
|---|---|---|
| `Listing.lastSeenAt` | B9 | todo (C, Phase 1) |
