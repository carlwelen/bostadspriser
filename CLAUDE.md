# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Web app that aggregates, analyzes, and visualizes apartment sale prices in Stockholm's inner city (Östermalm, Vasastan, Norrmalm, Södermalm). Original Swedish brief: `plan.md`. Implementation plan: `/home/carlw/.claude/plans/okay-lets-start-with-federated-fox.md`.

## Stack

- **`web/`** — Next.js 15 App Router (TypeScript, Tailwind 4), Prisma 6, Recharts, Mapbox GL, h3-js (client-side hex aggregation).
- **`scraper/`** — Python 3.12 (Playwright + SQLAlchemy 2 + psycopg 3 + Click), single-worker, jittered.
- **Postgres 16** via `docker-compose.yml`.

`web/` and `scraper/` share one database. **Prisma owns the schema and migrations**; SQLAlchemy reflects it. If a column changes, edit `web/prisma/schema.prisma`, run `pnpm exec prisma migrate dev`, then update Python call sites — never the other way around.

## Common commands

| Task | Command |
|---|---|
| Start Postgres | `docker compose up -d postgres` |
| Install web deps | `cd web && pnpm install` |
| Migrate DB | `cd web && pnpm exec prisma migrate dev` |
| Web dev server | `cd web && pnpm dev` (→ <http://localhost:3000>) |
| Web typecheck | `cd web && pnpm exec tsc --noEmit` |
| Web lint | `cd web && pnpm lint` |
| Install scraper deps | `cd scraper && uv sync` |
| Install Playwright browser (one-time) | `cd scraper && uv run playwright install chromium` |
| Initial backfill (one district) | `cd scraper && uv run scraper scrape --district ostermalm --since 2025-05-03` |
| Daily refresh (all 4 districts) | `cd scraper && uv run scraper update` |
| Geocode pending rows | `cd scraper && uv run scraper geocode --limit 200` |
| DB stats | `cd scraper && uv run scraper stats` |
| Run scraper tests | `cd scraper && uv run pytest -q` |

`pnpm` and `uv` are user-local at `~/.npm-global/bin/pnpm` and `~/.local/bin/uv`. If they're not on PATH, prepend `export PATH=~/.npm-global/bin:~/.local/bin:$PATH` to commands.

## Version pins (load-bearing)

- **Node 18.19.1** is what's installed; **Node 20+** is preferred but not available here. This forces:
  - **Next.js pinned to ^15** (Next 16 needs Node ≥20.9).
  - **Prisma pinned to ^6** (Prisma 7 needs Node ≥20.19).
  - If the user upgrades Node, both can be bumped freely.
- pnpm needs `@tailwindcss/oxide-linux-x64-gnu` listed explicitly under `devDependencies` — the auto-resolved optional dep doesn't always install on this platform, and Tailwind 4 won't compile without the native binary.
- The Python scraper uses `psycopg` (v3); SQLAlchemy's default `postgresql://` URL routes to psycopg2, so `db.engine()` rewrites the URL to `postgresql+psycopg://`.

## Architecture notes

### Schema
- `Listing` is the single primary table — one row per sold listing, with `(source, sourceId)` as the natural key for idempotent re-scrapes. Indexes are tuned for the three required aggregation axes: `(district, soldAt)`, `(street, houseNumber, soldAt)`, `(lat, lng)`.
- Prisma's `@default(uuid())` is a client-side default. SQLAlchemy reflection doesn't see it, so the Python scraper generates `id = str(uuid.uuid4())` per row in `_to_row`.

### Aggregations live in SQL
`web/src/lib/aggregations.ts` is the single home for `AVG`, `date_trunc`, `GROUP BY` queries used by both the API routes and the server-rendered pages. Don't pull listings into memory and reduce.

### Hemnet scraper
Hemnet sits behind Cloudflare and ships listing data inside `__NEXT_DATA__.props.pageProps.__APOLLO_STATE__`, keyed by Apollo-cache id with `__typename == "SaleCard"`. Plain `httpx` gets a 403 challenge; we need real Chromium.

Bot-protection handling (first-class concern):
- **Single-worker, jittered 3–5 s delay** between page fetches.
- **Persistent storageState** at `scraper/.state/storageState.json` — re-using cookies dramatically lowers Cloudflare friction. *Don't `rm -rf` it between runs.*
- **HTML cache** at `scraper/.cache/<date>_<urlhash>.html`. Challenge pages ("Vänta…", "Just a moment…") are detected via `_looks_real()` and never cached.
- **CF challenge resolution** — after `goto`, `_fetch` waits for `script#__NEXT_DATA__` and re-checks `_looks_real()` for up to ~12 s before retrying.
- **429/503 → exponential backoff** up to 10 minutes via tenacity, then exit cleanly so cron can retry next cycle.
- **Soft-real fields** are localized strings: `"4 900 000 kr"`, `"35 m²"`, `"2,5 rum"`. Parsers in `normalize.py` are tested in `tests/test_normalize.py` — keep them tolerant of non-breaking spaces and comma decimals.
- **`soldAt` is Stockholm-local midnight encoded as Unix epoch.** Converting in UTC drops the date by one during DST. `_to_row` uses `ZoneInfo("Europe/Stockholm")` to match the "Såld <day>" label.

### Geocoding
For Hemnet rows, `coordinates.lat/long` ship inline with each `SaleCard` — `_to_row` populates lat/lng directly and stamps `geocodedAt`. The `scraper geocode` command remains for sources that don't ship coordinates (Booli, future).

### Heatmap
The landing page (`/`) toggles between two visualizations:
- **Pris** — color-by-`pricePerSqm` heatmap layer + circle dots with hover popups. Light style, flat camera.
- **Frekvens** — h3-js client-side aggregation at resolution 10 (~65 m hex), rendered as a `fill-extrusion` layer with `extrusion-height` keyed off the count. Camera tilts to 55° pitch automatically when this mode is active.

Both layers source the same `/api/heatmap?districts=…` GeoJSON. The API caps at 5,000 features and supports an optional `bbox` filter.

## Routes

| Path | Purpose |
|---|---|
| `/` | Landing — full-bleed Mapbox map + sidebar (district filters, Pris/Frekvens, Heat map toggle) |
| `/district/[slug]` | District summary: count, mean kr/m², MoM %, top 12 streets, recent sales, monthly chart |
| `/street/[district]/[street]` | Street drill-down: chart, house-number list, recent sales |
| `/street/[district]/[street]/[house]` | Address drill-down: chart with street overlay, sales |
| `/compare?series=district:ostermalm,district:vasastan` | Multi-series chart |
| `/api/timeseries?scope=district\|street&id=…&granularity=month\|year` | JSON time series |
| `/api/heatmap?districts=…&bbox=w,s,e,n` | GeoJSON FeatureCollection |
| `/api/streets?district=…` | Per-district street summary |

All API responses send `Cache-Control: public, max-age=60, stale-while-revalidate=300`.

## What's next

- Booli source (the brief mentions an API; would slot under `source = "booli"` and use the same `_to_row` shape).
- Wire the top nav's "Filtrera" / "Sök gata" buttons to a real filter sheet / typeahead.
- A Postgres unique index on `(source, sourceId)` is already enforced by Prisma; if scraper throughput becomes a bottleneck consider batching upserts.
