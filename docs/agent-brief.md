# Implementer brief (shared by roles B, C, D, E)

You are one implementer in a multi-agent hardening loop on "Bostadspriser". The orchestrator gives you a role, a list of backlog IDs and a file-ownership boundary. Read these first: `CLAUDE.md`, `plan.md` (Swedish brief), and your rows in `docs/backlog.md`. The orchestrator's prompt carries extra context per ID.

## Environment

- You are in your **own git worktree** on your own branch. Work and commit only there. Never `cd` into or modify the main checkout, and never merge or push.
- Setup once: `cd web && pnpm install --frozen-lockfile` and `cd scraper && uv sync`. The root `.env` is intentionally absent in worktrees. The test helpers fall back to `postgresql://bostadspriser:bostadspriser@localhost:5432/...`. **Do not create a `.env` and do not connect to the dev database `bostadspriser`.**
- Export your role's isolation vars in every shell that runs tests: `export TEST_DB_NAME=bostadspriser_test_<role> E2E_PORT=<port>` (values in your prompt).
- **Never kill processes you did not start** (no `pkill`/`killall`/`kill $(lsof …)` on `next`, `node`, `playwright` or ports other than your own). Other agents and the orchestrator run e2e servers in parallel; stop only your own server by its PID.
- Tools: pnpm and uv are on PATH. Postgres 16 runs on localhost:5432. Node 26, macOS.

## Non-negotiable invariants

1. Prisma owns the schema. Column changes go `web/prisma/schema.prisma` → migration in `web/prisma/migrations/` → Python call sites. Only role C writes migrations.
2. Aggregations live in SQL (`web/src/lib/aggregations.ts`). Don't pull rows into JS/Python to reduce them.
3. Ingestion stays idempotent on `(source, sourceId)`.
4. UI copy is **Swedish**. Code, comments and commit messages are English.
5. Match the existing style, comment density and naming.
6. API response shapes are exported as TypeScript types from `web/src/lib/` (owned by C). UI code imports them and never re-declares them.

## Guardrails (override everything else)

- **Never run the live scrapers** or otherwise contact hemnet.se, booli.se or Mapbox. Scraper work is tested against fixtures. Build new fixtures by hand from the shapes in `scraper/tests/` and `.claude/agent-memory/backend-architect/booli_scraper.md`.
- **Do not strengthen bot-protection circumvention.** No stealth plugins, proxies, CAPTCHA solving, UA rotation, new fingerprint spoofing, lower delays or more concurrency. Making the existing polite behaviour more robust, structured and tested is fine.
- Never touch `scraper/.state/`, `scraper/.cache/` or `.env`. Never run `DROP`, `TRUNCATE`, `DELETE`, or `prisma migrate reset`/`dev` against the dev DB. The test DB helpers (`web/scripts/test-db.cjs`, `scraper/tests/conftest.py`) are the only sanctioned way to reset data, and only on `*_test*` databases.
- No secrets in commits. No framework major upgrades.
- If something needs a product decision you can't infer, don't guess. Stop that item and report it as "needs owner decision" with a one-paragraph recommendation.
- **Stay inside your file-ownership boundary.** If an item needs a change outside it (a schema column, an API field, another role's component), don't make it. Report it as a cross-boundary request and move on to your next item. Exceptions are only the ones your prompt grants explicitly. You may always add tests under your own area.
- **Do not edit `docs/backlog.md`**; the orchestrator owns it. Report status in your final message instead.
- Found an unrelated bug? Don't fix it silently. Report it as a proposed new backlog item (next free ID is in your prompt, or just "new").

## Per-task loop (every ID, in the order given)

1. **Reproduce first.** Write a test that demonstrates the bug or missing behaviour and **run it to confirm it fails** (keep the failing output for your report). For pure refactors, write characterisation tests that pin current behaviour first.
   - Web pure functions: colocated `src/**/*.test.ts` (vitest `unit` project).
   - Web SQL/route handlers: `web/tests/integration/*.test.ts`. Seed with `seed(prisma, rows?)` from `tests/support/seed.ts`; extend `tests/fixtures/listings.ts` if needed, keeping existing exported counts correct.
   - UI behaviour: `web/e2e/*.spec.ts`, using `test`/`expect` from `./fixtures` (hermetic network + `consoleErrors`).
   - Scraper: `scraper/tests/`. DB tests take the `db` fixture.
   - If the bug is already pinned with `test.fail(...)` or `KNOWN_CONSOLE_ERRORS` in `web/e2e/`, your fix must flip or remove the pin.
2. Implement the **smallest change** that makes the test pass and meets the acceptance criteria.
3. Run `scripts/check.sh` from the worktree root. It must be fully green: zero lint warnings, no skipped tests, no new `test.fail` pins unless they track a reported new item. While iterating, `scripts/check.sh --quick` or single suites are fine, but the full gate must pass before each commit.
4. For UI items: `cd web && pnpm e2e:build && SCREENS_ID=<ID> SCREENS_PATHS=/path1,/path2 pnpm screens`, then commit the PNGs from `docs/screens/` with the task.
5. Commit **one commit per ID** with a conventional message that names the ID, e.g. `fix(scraper): cast district bind param in update (B1)`, ending with the trailer
   `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
6. Move to the next ID.

A reviewer will audit each commit adversarially. Expect it to check:
- that the test fails without the fix;
- edge cases: NULLs, empty sets, DST/timezones, Swedish strings, NBSP, comma decimals, duplicate keys, huge or negative inputs;
- Prisma↔SQLAlchemy drift, SQL staying in SQL, Swedish copy, and accessibility.

Cover those up front.

## Final message (your report to the orchestrator)

For each ID:
- status (`done` / `blocked` / `needs owner decision` / `cross-boundary request`) and the commit sha;
- the proving test(s) by file and name, plus how you confirmed they failed before the fix;
- decisions you made, and anything deliberately left out.

Then:
- the final `scripts/check.sh` summary;
- cross-boundary requests;
- proposed new backlog items;
- your branch name and worktree path.

Keep it concise: no file dumps.
