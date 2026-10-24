# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Web app that aggregates, analyzes, and visualizes apartment sale prices in Stockholm's inner city (Östermalm, Vasastan, Norrmalm, Södermalm). Original Swedish brief: `plan.md`. Work queue and status ledger: `docs/backlog.md`.

## Stack

- **`web/`**: Next.js 15 App Router (TypeScript, React 19, Tailwind 4), Prisma 6, Recharts, Mapbox GL, h3-js (client-side hex aggregation).
- **`scraper/`**: Python 3.12 (Playwright + SQLAlchemy 2 + psycopg 3 + Click + tenacity), single-worker, jittered. Two sources: Hemnet (`hemnet.py`) and Booli (`booli.py`).
- **Postgres 16** via `docker-compose.yml` (container `bostadspriser-postgres`).

`web/` and `scraper/` share one database. **Prisma owns the schema and migrations**; SQLAlchemy reflects it. To change a column: edit `web/prisma/schema.prisma`, create a migration (`pnpm exec prisma migrate dev --create-only` against a *test* DB, or hand-write it), then update the Python call sites. Never the other way around.

## Toolchain (this machine)

macOS (darwin/arm64), Node 26, pnpm 12, uv, Python 3.12. The docker CLI lives at `/Applications/Docker.app/Contents/Resources/bin`.

- pnpm 10+ ignores dependency build scripts unless allowlisted; the allowlist is `allowBuilds` in `web/pnpm-workspace.yaml` (Prisma, sharp, unrs-resolver).
- The single `.env` lives at the repo root. `web/next.config.ts` loads it via `@next/env`; the scraper's `config.py` loads it with python-dotenv. Prisma CLI commands need `DATABASE_URL` in the environment (export it, or run from a shell that sourced `.env`).
- Next.js is still pinned to 15 and Prisma to 6. Node ≥ 20 is available now, so both *can* be upgraded, but only as a separate, reviewed task (see backlog).
- **macOS + Python ≥ 3.13 gotcha:** `.pth` files flagged `hidden` (iCloud-synced `~/Documents` sets it) are skipped, so `import scraper` / `uv run scraper` fail with `ModuleNotFoundError`. pytest is immune (`pythonpath = ["src"]`); `scripts/check.sh` clears the flag; manually: `chflags nohidden scraper/.venv/lib/python3*/site-packages/*.pth`.
- The Python scraper uses `psycopg` (v3); SQLAlchemy's default `postgresql://` URL routes to psycopg2, so `db.engine()` rewrites the URL to `postgresql+psycopg://`.

## Common commands

| Task | Command |
|---|---|
| **Full gate (run before every commit)** | `scripts/check.sh` (`--quick` skips build + e2e; not the gate) |
| Start Postgres | `docker compose up -d postgres` |
| Install web deps | `cd web && pnpm install` |
| Apply migrations to the dev DB | `cd web && DATABASE_URL=… pnpm exec prisma migrate deploy` |
| Web dev server | `cd web && pnpm dev` (→ <http://localhost:3000>) |
| Typecheck / lint | `cd web && pnpm typecheck` / `pnpm lint` (zero warnings allowed) |
| Unit tests (vitest, no DB) | `cd web && pnpm test:unit` |
| Integration tests (vitest + test DB) | `cd web && pnpm test:int` |
| E2E smoke (Playwright) | `cd web && pnpm e2e:build && pnpm test:e2e` |
| Coverage | `cd web && pnpm test:coverage`; `cd scraper && uv run pytest --cov=scraper` |
| Screenshots for UI tasks | `cd web && pnpm e2e:build && SCREENS_ID=F1 SCREENS_PATHS=/a,/b pnpm screens` → `docs/screens/` |
| Test DB helper | `cd web && node scripts/test-db.cjs url\|ensure\|reset` |
| Install scraper deps | `cd scraper && uv sync` |
| Install Playwright browser (one-time) | `cd scraper && uv run playwright install chromium` |
| Scraper tests / lint | `cd scraper && uv run pytest -q` / `uv run ruff check` |
| Initial backfill (one district) | `cd scraper && uv run scraper scrape --source hemnet --district ostermalm --since 2025-05-03` |
| Daily refresh (all sources × districts) | `cd scraper && uv run scraper update` |
| Geocode pending rows | `cd scraper && uv run scraper geocode --limit 200` |
| Backfill dedup keys | `cd scraper && uv run scraper backfill-dedup` |
| DB stats | `cd scraper && uv run scraper stats` |

## Testing

- **Never point tests at the dev DB (`bostadspriser`).** Test databases are resolved by `web/scripts/test-db.cjs` (web) and `scraper/tests/conftest.py` (pytest): `TEST_DATABASE_URL`, else `DATABASE_URL` with the name replaced by `TEST_DB_NAME` (default `bostadspriser_test`). Both refuse any database whose name lacks a `test` segment, and truncation re-checks `current_database()`.
- Parallel worktrees: give each one its own `TEST_DB_NAME` (e.g. `bostadspriser_test_b`) and `E2E_PORT`.
- Web integration tests (`web/tests/integration/`) call `aggregations.ts` functions and route handlers (`GET(new Request(…))`) directly against the seeded test DB. The deterministic fixture is `web/tests/fixtures/listings.ts`; seeding is `web/tests/support/seed.ts`.
- E2E (`web/e2e/`) runs a production build from `.next-e2e/` with an empty `NEXT_PUBLIC_MAPBOX_TOKEN`; every off-origin request is aborted. Known baseline bugs are pinned as `test.fail(...)` (or listed in `KNOWN_CONSOLE_ERRORS`) with their backlog ID. The fixing commit flips them.
- Scraper DB tests request the `db` fixture; it migrates the test DB via `pnpm exec prisma migrate deploy` (so `web/node_modules` must be installed) and truncates all tables per test. conftest also redirects the cache/state dirs to a temp dir and sets a fake `MAPBOX_TOKEN`.
- **Never run the live scrapers in tests.** Scraper tests are fixture-based (captured `SaleCard` / `SoldProperty` shapes).

## Architecture notes

### Schema
- `Listing` is the single primary table: one row per sold listing per source, with `(source, sourceId)` as the natural key for idempotent re-scrapes. Indexes: `(district, soldAt)`, `(street, houseNumber, soldAt)`, `(lat, lng)`, `(dedupKey)`.
- `dedupKey` = blake2b of normalized address + soldAt + price (`normalize.dedup_key`); it collapses the same sale seen via Hemnet and Booli.
- **All reads go through the `"DedupedListing"` view**: `DISTINCT ON` the sale's group key (`dedupKey`, falling back to `id`), preferring priced rows, then rows with coordinates, then Hemnet, then the latest `lastSeenAt`, then `id`; it adds a `sources text[]` column. Recreating the view is needed whenever `Listing` gains a column (`l.*` is frozen at creation).
- Other tables: `ScrapeRun` (one row per source/district crawl; written by the scraper, read by `latestScrapeRuns()`/`sourceFreshness()`). `Listing.geocodeStatus`/`geocodeAttempts` track geocoding, `Listing.lastSeenAt` is bumped on every upsert.
- Prisma's `@default(uuid())` is a client-side default. SQLAlchemy reflection doesn't see it, so the scraper generates `id = str(uuid.uuid4())` per row in `_to_row`.

### Aggregations live in SQL
`web/src/lib/aggregations.ts` is the home for every query used by API routes and server-rendered pages (means, medians via `percentile_cont`, `date_trunc` buckets). Don't pull listings into memory and reduce. Routes stay thin: parse with the zod schemas in `web/src/lib/api-validation.ts` (400 JSON on bad input, `withApiErrors` → 500 JSON + server log), call an aggregation, shape the response. Response types live in `web/src/lib/api-types.ts`; UI code imports them.

Date cut-offs ("last N days", "current month") must use `stockholmToday(asOf)` and take an `asOf` parameter so tests can pin time; never `CURRENT_DATE`/`now()`, which follow the DB session's time zone.

### Scrapers
Both sites render server-side and ship data in `__NEXT_DATA__.props.pageProps.__APOLLO_STATE__`: Hemnet as `__typename == "SaleCard"`, Booli as `"SoldProperty"`. See `.claude/agent-memory/backend-architect/booli_scraper.md` for Booli specifics (area IDs, `descriptiveAreaName` district filter).

Polite-crawling behaviour (do not make it more aggressive or add circumvention):
- **Single worker, jittered 3–5 s delay** between page fetches.
- **Persistent storageState** at `scraper/.state/storageState.json`. *Don't delete it between runs.*
- **HTML cache** at `scraper/.cache/<date>_<urlhash>.html`. Challenge pages are detected via `_looks_real()` and never cached.
- **429/503 → exponential backoff** via tenacity, then the page is skipped so cron can retry.
- **Localized fields**: `"4 900 000 kr"`, `"35 m²"`, `"2,5 rum"`. Parsers in `normalize.py` (tests in `tests/test_normalize.py`) must tolerate NBSP and comma decimals.
- **Hemnet `soldAt` is Stockholm-local midnight as Unix epoch.** Converting in UTC drops a day during DST; `_to_row` uses `ZoneInfo("Europe/Stockholm")`. Booli ships `soldDate` as `YYYY-MM-DD`.

### Geocoding
Both sources usually ship coordinates inline; `_to_row` fills lat/lng and stamps `geocodedAt`. `scraper geocode` (Mapbox) handles rows without them.

### Heatmap
The landing page (`/`) toggles between two visualizations:
- **Pris**: color-by-`pricePerSqm` heatmap layer + circle dots with hover popups. Flat camera.
- **Frekvens**: h3-js client-side aggregation at **resolution 9** (~175 m edge), rendered as `fill-extrusion` keyed off the count; camera tilts to 55°.

Both read `/api/heatmap` GeoJSON. The query currently caps at **50,000** features (B25 will pick a deliberate cap) and supports `districts`, `bbox`, `rooms` (`5` = 5 or more), `priceMin`/`priceMax` (0 = no bound), `sinceDays`. Popups are built from DOM nodes (`web/src/components/map/popups.ts`); never `setHTML`/`innerHTML` with scraped strings.

## Routes

| Path | Purpose |
|---|---|
| `/` | Landing: full-bleed Mapbox map + sidebar (districts, rooms, period, Pris/Frekvens, heatmap toggle) + address drawer |
| `/district/[slug]` | District summary: count, mean kr/m², MoM %, top streets, recent sales, monthly chart |
| `/street/[district]/[street]` | Street drill-down: chart, house-number list, recent sales |
| `/street/[district]/[street]/[house]` | Address drill-down: chart with street overlay, sales |
| `/compare?series=district:ostermalm,street:vasastan/odengatan` | Multi-series chart |
| `/insights` | Dataset-wide stats: distribution, rooms breakdown, top movers, scatter |
| `/api/timeseries?scope=district\|street&id=…&granularity=month\|year` | JSON time series |
| `/api/heatmap?districts=…&bbox=w,s,e,n&rooms=…&sinceDays=…` | GeoJSON FeatureCollection |
| `/api/streets?district=…&limit=…` | Per-district street summary |
| `/api/streets/all` | All streets (search index) |
| `/api/address?district=…&street=…&house=…&period=30d\|3mo\|12mo\|all` | Address-drawer data |

API responses send `Cache-Control: public, max-age=60, stale-while-revalidate=300` (`/api/streets/all`: 300/600). `sitemap.xml` is rendered per request so `next build` needs no database.

## Gotchas

- **Recharts 3.8.1 + React 19 + Next 15.5:** never set `isAnimationActive={false}` on `PriceChart` series. On production builds it silently stops client-side `<Link>` navigation from committing. `e2e/granularity.spec.ts` guards this.
- **Reads come from `"DedupedListingMat"`, a materialized snapshot.** It only changes when `refresh_deduped_listing()` runs. The scraper calls it after every writing command; `scraper refresh-view` runs it by hand. Any migration that changes `Listing` columns must drop and recreate both the mat view and the `DedupedListing` view.
- **Scraper exit codes:** 0 ok, 1 failure, 75 lock busy or rate-limited or unavailable (retry later), 78 Mapbox token missing or rejected.

## Conventions

- UI copy is **Swedish**; code, comments and commit messages are English.
- One commit per backlog item, conventional message with the ID: `fix(scraper): … (B1)`.
- New problems get a new backlog ID (`B30+`, `F26+`); don't fix them silently in an unrelated commit.
