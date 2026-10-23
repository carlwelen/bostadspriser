# bostadspriser

Web app that aggregates, analyzes, and visualizes apartment sale prices in Stockholm's inner-city districts (Östermalm, Vasastan, Norrmalm, Södermalm). See `plan.md` for the original Swedish brief, `CLAUDE.md` for architecture and conventions, and `docs/backlog.md` for the work ledger.

## Layout

```
.
├── docker-compose.yml   # Postgres 16
├── scripts/check.sh     # the full test/lint gate
├── docs/                # backlog ledger, perf notes, screenshots, report
├── web/                 # Next.js 15 (App Router, TS, Tailwind 4, Prisma 6)
└── scraper/             # Python 3.12 (Playwright + SQLAlchemy), Hemnet + Booli
```

## Prerequisites

- **Docker** (for local Postgres), or any Postgres 16 whose user may create databases (the tests create their own)
- **Node.js ≥ 20** (developed on 26) + **pnpm ≥ 10** (`corepack enable` or `brew install pnpm`)
- **Python ≥ 3.12** + **uv** (`brew install uv` or `curl -LsSf https://astral.sh/uv/install.sh | sh`)
- A **Mapbox** account. Get a public token from <https://account.mapbox.com>. The token is shipped to browsers by design (`NEXT_PUBLIC_MAPBOX_TOKEN`), so **restrict it to your site's URLs** in the Mapbox dashboard.

## Setup

```bash
cp .env.example .env        # paste your Mapbox token
docker compose up -d postgres

cd web
pnpm install
export $(grep DATABASE_URL ../.env)
pnpm exec prisma migrate deploy   # creates the tables + DedupedListing view
pnpm dev                          # http://localhost:3000

cd ../scraper
uv sync
uv run playwright install chromium          # one-time, ~150MB
uv run scraper scrape --source hemnet --district ostermalm --since 2025-04-01
uv run scraper update                       # incremental refresh, all sources
uv run scraper geocode --limit 200          # rows without coordinates
uv run scraper stats
```

## Tests

```bash
scripts/check.sh            # typecheck, lint, vitest (unit + integration), build, Playwright e2e, ruff, pytest
scripts/check.sh --quick    # same without build + e2e
```

Tests never touch the dev database. They use `bostadspriser_test` (override with `TEST_DB_NAME` or `TEST_DATABASE_URL`). The name must contain `test`, and the gate drops and recreates that database on every run.

## Scraping etiquette

The scraper is single-worker, sleeps 3–5 s with jitter between requests, caches fetched HTML to `scraper/.cache/`, and persists cookies to `scraper/.state/storageState.json`. On 429/503 it backs off exponentially and moves on so cron can retry. Whether scraping Hemnet and Booli is acceptable under their terms is an open owner decision (see `docs/backlog.md`).
