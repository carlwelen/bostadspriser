# bostadspriser

Web app that aggregates, analyzes, and visualizes apartment sale prices in Stockholm's inner-city districts (Östermalm, Vasastan, Norrmalm, Södermalm). See `plan.md` for the original Swedish brief and `/home/carlw/.claude/plans/okay-lets-start-with-federated-fox.md` for the implementation plan.

## Layout

```
.
├── docker-compose.yml   # Postgres 16
├── web/                 # Next.js 15 (App Router, TS, Tailwind, Prisma)
└── scraper/             # Python 3.12 (Playwright + SQLAlchemy)
```

## Prerequisites

- **Docker** (for local Postgres)
- **Node.js ≥ 18.18** + **pnpm** (`npm i -g pnpm` if missing)
- **Python ≥ 3.12** + **uv** (`curl -LsSf https://astral.sh/uv/install.sh | sh`)
- A **Mapbox** account — free tier covers dev usage. Get a public token from <https://account.mapbox.com>.

## Setup

```bash
cp .env.example .env
# edit .env and paste your MAPBOX_TOKEN
```

### Postgres

```bash
docker compose up -d postgres
```

### Web app

```bash
cd web
pnpm install
pnpm exec prisma migrate dev --name init   # creates the Listing table
pnpm dev                                    # http://localhost:3000
```

### Scraper

```bash
cd scraper
uv sync
uv run playwright install chromium          # one-time, ~150MB

# Scrape one district, last 30 days
uv run scraper scrape --district ostermalm --since 2025-04-01

# Geocode rows missing lat/lng
uv run scraper geocode --limit 200
```

## Verify the vertical slice

```bash
psql "$DATABASE_URL" -c 'select count(*), district from "Listing" group by district;'
```

Then open <http://localhost:3000/district/ostermalm>.

## Scraping etiquette

The scraper is single-worker, sleeps 3–5 s with jitter between requests, caches all fetched HTML to `scraper/.cache/`, and persists cookies to `scraper/.state/storageState.json`. On 429/503 it backs off exponentially up to ~10 minutes and exits cleanly so cron can retry.
