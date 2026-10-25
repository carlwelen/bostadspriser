# Handoff: continuing the hardening loop (for Codex or any other agent)

## Current checkpoint (2026-10-25)

### Latest verified update

- F12e8b0b04 and docsc396c2c+9d670ed now APPROVED; reports f12-keyboard-correction-review.md and docs-hardening-correction-review.md. Dsourcee8b0b04 and B56sourcec68e1f2 pushed. E correctiond65f6b2 ready542/344/759, freshR /tmp/r-e-color-final active. Candidate9d670ed staged all corrections includingd65f6b2; fullgate /tmp/final-candidate-complete-gate.log running (test_final/3108). Then preparation commit and whole-code audits. F42 optional inherited keyboard date order.
- Next approved merge queue: c68e1f2,c0553f8,ceb3d11,717df2f,a8789bd,e8b0b04,7f21875,a374e52,0de29a4,671722a,c396c2c,9d670ed. Wrapper12 will gate each source and publish complete groups at e8b0b04/671722a/9d670ed. Stop flag only between green checkpoints. E final four commits wait on fresh review.

- Main9b59f3a includes approved F11 source7cb4a17 ->ed1785c, full510vitest292e2e759pytest. Published remote remainsb1730bb; chart group held for F12. Wrapper11 is terminal; no active integration. Queue now ends7cb4a17 (already integrated); HARDENING_NO_FINAL_PUSH=1 suppresses last-source push.
- F12 sourcee8b0b04 on hardening/d-map-phase3, full508/272/488+26browser, freshR report pending /tmp/r-f12-keyboard-final/REPORT.md. Remaining source order c0553f8,ceb3d11,717df2f,a8789bd,e8b0b04, then approved phase4 7f21875,a374e52,0de29a4,671722a. Use F37equivalent; skip5363f4b.
- B56c68e1f2 APPROVED, source /tmp/bostadspriser-hardening-b-refresh, full506/292/764 and769reviewerpytest. Report docs/review-probes/b56-review.md. Integrate with gate; source/main not yet pushed.
- E7b5e461(F21) andb2e1923(F23) APPROVED;492fdc0(F22) needs colour corrections. Final report docs/review-probes/e-final-batch-review.md saved before reviewer TPM error; scratch removed and reversion logs verified. E fixes interleaved colours/actual scatter contrast and preserves all8 palette tones; /tmp/e-f22-check-final.log running. Fresh correction review next. Optional inherited >8palette identity trackedF41.
- Required docs task c396c2c+9d670ed (CLAUDE/README/perf) needs fresh R /tmp/r-docs-correction/REPORT.md (test_r_docs2/3118), active. The correction's combined gate539/338/759 passed.
- Candidate /tmp/bostadspriser-final-candidate committed9d670ed; staged preparation a8789bd+E7b5e461/492fdc0/b2e1923+B56c68e1f2+F12e8b0b04. One additive chart-test conflict resolved keeping F21 and F12 tests,12focusedtests pass. Production merges preserve both changes. Await E correction, fullgate and immutable preparation snapshot. Preparation ancestry never merges to main.
- Current three subagents: E correction, F12 R, docs R. B56 R done. Main/test3100, candidate/test_final3108. Audit rounds0; required P1/P2 and two clean audits/report remain. No live/protected-data work. Previous bullets below are historical detail superseded by this update.

- Live integration checkpoint: c68e1f2 -> 20df838, full gate green. Remaining approved queue: c0553f8, ceb3d11, 717df2f, a8789bd, e8b0b04, 7f21875, a374e52, 0de29a4, 671722a, c396c2c, 9d670ed. F20 original4257179 and test12d76ea are folded into fe86f8b to keep each merge green; skip both originals. See backlog for active reviews and later follow-ups.

This checkpoint supersedes earlier status below. Read docs/backlog.md for per-ID status.

- **Published main at this checkpoint: c7faa38.** All original handoffs, backend follow-ups and D/E follow-ups through 8001be3 -> cf709b0 are integrated and green. /tmp/hardening-integration10.log completed and pushed. No wrapper currently running; do not restart its already-integrated queue.
- **D F12 correction:** /tmp/bostadspriser-hardening-d, hardening/d-map-phase3, a8789bd; test_d / 3104. Fresh R CHANGES REQUESTED: keyboard Tab -> chart, ArrowRight -> tooltip, Shift+Tab loses tooltip/focus. D implementing regression and smallest correction; see docs/review-probes/f12-keyboard-review.md. New commit needs fresh R. Later source queue: 7cb4a17, c0553f8, ceb3d11, 717df2f, a8789bd, then keyboard correction. F11/B14 approved, cumulative F12 pending.
- **Approved D phase4 queue:** 7f21875, a374e52 (equivalent F37; skip 5363f4b), 0de29a4, 671722a. Integrate after D median adoption. Published source hardening/d-map-phase4 through 671722a. F37 equivalent parent c896c75 is preparation-only.
- **E final batch:** 7b5e461 (F21), 492fdc0 (F22), b2e1923 (F23), source /tmp/bostadspriser-hardening-e, hardening/e-analytics-final, full 539 vitest / 334 e2e / 759 pytest. Fresh R underway (test_r_e_final / 3116), investigating colour collision; report /tmp/r-e-final/REPORT.md. Do not push yet.
- **Docs task:** c396c2c is the required CLAUDE-only update on integration/final-candidate, full 527 vitest / 316 e2e / 759 pytest. Fresh R CHANGES REQUESTED for module/refresh/canonical-key inaccuracies; report docs/review-probes/docs-hardening-review.md. Corrections are uncommitted in candidate, along with stale docs/perf.md B49 wording. Gate and fresh review required.
- **Combined candidate:** /tmp/bostadspriser-final-candidate (test_final / 3108), committed c396c2c atop 512d50e, now uncommitted preparation a8789bd + E final three commits applied cleanly. Await D correction, then full gate and immutable preparation commit. Source code includes all B/C/E and D phase4. Preparation ancestry must never be merged into main.
- **Skip folded originals:** E 4257179 + 12d76ea folded into fe86f8b; C acd9acb folded into 991a460; F37 5363f4b replaced by a374e52. Preparation bases 1426915, 3a2494a, 16b4629, 96bcc91, f987cf7, f125002, 512d50e, c896c75 are not task commits.
- **New P1 B56:** docs reviewer exposed backfill-dedup missing refresh after a later batch fails following earlier commits. B implements a test-first isolated-DB correction at /tmp/bostadspriser-hardening-b-refresh, hardening/b-refresh-failure, test_b56 / 3102. Preserve nonzero failure, no live operation.
- **Audit rounds 0.** Complete unblocked required P1/P2, two consecutive fresh whole-code audits without new P0/P1, then docs/REPORT.md and final green main push. B16 owner decision stays blocked with recommendation; P3 optional. No live scrapers/geocoding/pruning or protected-data access.
- **Runtime:** user authorized GitHub pushes, root only. At most three subagents, implementers gpt-6.1-sol, fresh read-only reviewers gpt-6-astra. No ghost agent now. Root started a new owned 12-hour caffeinate on Oct25 (session 18284). Runtime/rate-limit recovery cannot be guaranteed; preserve exact checkpoints.

Written 2026-10-23 when the Claude Code orchestrator ran out of budget. Read this first, then `AGENTS.md`, `CLAUDE.md` and `docs/backlog.md`.

## 0. Starting Codex

`scripts/start-codex.sh` starts an interactive session; add `--exec` for a non-interactive run. The orchestrator and reviewers use `gpt-6-astra` with high reasoning; implementer sub-agents use `gpt-6.1-sol`. The script sets a workspace-write sandbox with network access for localhost Postgres and e2e. If tests fail on sandbox permissions, use `SANDBOX=danger-full-access scripts/start-codex.sh`.

## 1. Where things stand

- **`main` is green.** `scripts/check.sh` passed after every merge. That covers typecheck, lint with 0 warnings, vitest unit + integration, the production build, Playwright e2e on desktop + Pixel 7, ruff and pytest.
- **All P0 items are done.** P1 is mostly done or waiting to be merged. P2/P3 are partly done. See `docs/backlog.md` for the per-item status, shas and notes.
- **No audit round has run yet.** The stop condition needs two consecutive clean ones (§5).
- **Open owner decision:** the Mapbox geocoding storage terms. See "Owner decisions" in `docs/backlog.md`.

## 2. Unmerged work waiting on branches

> **Update at the end of the Claude session:** §2a's B46 and B16 review 4 commits, and **all of §2b**, are now **merged on `main`**, with the gate green after each. **Still unmerged:** `d0e24c6` (B13 matcher, changes requested, see below) and **all of §2c**. The E batch was reviewed: 8 of 11 commits are approved, and F20, F11/F12 and F28 need fixes. See `docs/review-probes/e-batch-review.md`. Always confirm with `git cherry -v main <branch>`.

Each block below is a branch with commits that are **not on `main` yet**. Merge each block in the order shown, **oldest commit first**, using `scripts/merge-seq.sh <sha> <sha> …`. The script cherry-picks one commit at a time and runs the full gate after each. List what is still unmerged with `git cherry -v main <branch>` (lines starting with `+`).

### 2a. `handoff/b-scraper`: merge FIRST

`bf9588f 3854f27 d02d789 c2ed80f d0e24c6`

| sha | Item | Review state when handed off |
|---|---|---|
| `bf9588f`, `3854f27`, `d02d789` | **B46**: the scraper calls `refresh_deduped_listing()` after writing commands; `refresh-view`; `stats` compares mat vs live | **Approved.** The integration with C's 13 commits was verified: web, then pytest, then web, then e2e all passed on one DB. |
| `c2ed80f` | B16 review 4: geocode order rotates, only full-budget rows are charged | **Approved** |
| `d0e24c6` | **B13 matcher**: `scraper cluster`, plus a check for one clusterId per dedupKey | **CHANGES REQUESTED. Do not merge as is.** See below. |

**B13 matcher review findings (to fix before merging `d0e24c6`):**
1. *Major:* false positives chain. Two flats at one address, each reported by both sources, sold 2 days apart at prices within 0.5% get cross-matched and merged into one sale. On the 200k perf copy, 127 clusters merged two real sales.
   - Require `|ΔareaSqm| ≤ 1 m²` (or ≤ 2%) and `|Δrooms| ≤ 0.5` when both are known.
   - **Never** union components so that one cluster holds two different dedupKeys from the same source.
   - Process candidate pairs closest-first.
2. *Major:* clusters are never undone. A row re-scraped or reparsed to a different price stays merged and hides a sale. Either clear `clusterId` on upsert or reparse when `dedupKey` changes, or recompute all components each run (about 1.5 s at 200k rows) and write only the diffs.
3. *Minor:* `--dry-run` over-counts `rows_updated`.
4. *Minor:* a dedupKey split across clusters with no cross-source partner is never healed; seed the union-find from `dedup_keys_in_multiple_clusters()`.
5. *Nit:* translate both cases of åäöéè in the SQL key.

The reviewer's probe tests are in `docs/review-probes/b13_matcher_probe.py`. Copy it to `scraper/tests/`: tests 4–6 assert the buggy behaviour, so invert them as the failing-first tests.

The B46 refresh calls are **guarded**: they do nothing until the SQL function exists. That is why B merges before C.

### 2b. `handoff/c-data`: merge SECOND, right after B46

`0ab262e 14ae682 5e2ded6 7810ca4 4b4bfc8 a64fa4a cb6f630 01b4e94 0ebb0b7 04964a4 b1875a1 733bbbf 7bd12c2`

**All review-approved**, including `7bd12c2`, the B24 review fix (in-memory data cache via `isrFlushToDisk:false`, salt removed). Its re-review verified on a real server that there is no disk growth and that cache hits and revalidation work.

| Items | What |
|---|---|
| B21 | Reads come from the materialized view `"DedupedListingMat"`; the perf record is in `docs/perf.md` |
| B25 | Heatmap capped at 30k rows, with a `truncated` flag |
| B26 | `topMovers` uses medians and disjoint windows |
| B23 | `lib/text.ts` plus `shared/slug-vectors.json` |
| B24 | Tag-based caching plus `POST /api/revalidate` |

**Why the order matters:** after B21 the web app reads a *snapshot* that only changes when `refresh_deduped_listing()` runs. Without B46 the site would silently show stale data after a scrape.

### 2c. `handoff/e-analytics`: merge THIRD

`2ef182e 4257179 8a61a15 22a62cf 12d76ea 85fe265 c6d646c 5ab1bbf 4bd971d f07ca97 7627e4d`

**Reviewed: 3 commits need changes first.** The findings and probe tests are in `docs/review-probes/e-batch-review.md` and `e_batch_probe.spec.ts`. Add the fixes as new commits on the branch, re-review them, then merge the whole branch.

| Items | What |
|---|---|
| F32 + F27 | No horizontal page overflow on mobile |
| F20 (E part) | Mobile nav |
| F34 | Singular/plural copy |
| F13 UI + F31 | SQL summary cards |
| B14 UI | Median shown by default |
| F8 | Month/year toggle |
| F10 | Address, street and district series together |
| F11 + F12 | Time axis, n in tooltips, low-n buckets muted |
| F18 | Data freshness indicator |
| F28 + F29 | Recharts SSR warnings; copy fixes |

E branched from a `main` that did not yet have C's 2b commits (now merged). Expect small conflicts in pages that consume `aggregations.ts`. Resolve them, then run the gate.

### After the merges

`docs/backlog.md` already says what each item still needs. The direct follow-ups:

- **F35 (E):** the insights movers card and subtitle must match B26: last 90 days vs the prior 12 months, medians, recent/prior n.
- **B49 (B):** the scraper calls `POST $APP_URL/api/revalidate` with `Authorization: Bearer $REVALIDATE_SECRET` (16+ characters) after each refresh.
- **F16 (C then E):** add a `rooms?: number[]` parameter to `districtTimeseries`, `streetTimeseries`, `streetSummary` and `districtStreetCount`, where 5 means "5 or more". Then add the room chips to the district and street pages.
- **D adopts B23:** `StreetSearch` uses `foldForSearch`, `AddressDrawer` uses `slugifyStreet`. Also: the map UI hint for heatmap `truncated`, and `BrandMark compact` replacing D's CSS hack on `/`.
- **B51 (C):** the data cache bound is 50 MB of *serialised* payload, which can mean several hundred MB of heap with many tiny entries. Set an explicit smaller `cacheMaxMemorySize` (8–16 MB) and don't cache `streetFromSlug` misses.
- **B23 (Python):** assert `shared/slug-vectors.json` in pytest.
- **Update `CLAUDE.md`:**
  - new scraper modules: `source_base.py`, `crawl_state.py`, `lock.py`, `scrape_run.py`, `pagination.py`, `reparse.py`, `cluster` code;
  - commands: `backfill`, `reparse`, `cluster`, `refresh-view`, plus `--log-level` and `--max-pages`;
  - exit codes: 0 ok, 1 failure, 75 lock busy, rate-limited or unavailable, 78 bad Mapbox token;
  - the mat-view refresh rule and the data cache and revalidate flow.

## 3. How the work was run (keep doing it this way)

- **Roles and file ownership:** §6 of the original brief. In short:
  - B scraper owns `scraper/**`.
  - C data/API owns `web/prisma/**`, `web/src/lib/**` and `web/src/app/api/**`.
  - D map UI owns `web/src/app/page.tsx` and the map components under `web/src/components/map/**`.
  - E analytics UI owns the other pages and components.
  - R reviewer is read-only.
  - A single agent can play every role, one task at a time; ownership still decides which commits belong together.
- **The per-task loop** is in `docs/agent-brief.md`: failing test first, smallest fix, full `scripts/check.sh`, one commit per backlog ID.
- **The reviewer checklist** is in `docs/reviewer-brief.md`. Every review so far found real issues, so keep reviewing adversarially. The most important check: "does the test fail without the fix?"
- **Ledger:** `docs/backlog.md` is the single source of truth. `scripts/ledger.py` helps edit rows; its usage is in the file's docstring. Keep the "Orchestration state" section current so the next session can resume.

## 4. Practical notes and gotchas

- **Never kill processes you didn't start.** No `pkill next` or similar. Two e2e runs were broken this way.
- **Test databases.** Tests never touch the dev DB `bostadspriser`. Use `TEST_DB_NAME=bostadspriser_test_<something>`; the helpers refuse any name without `test` in it. When running work in parallel, give each runner its own `TEST_DB_NAME` and `E2E_PORT`.
- **macOS + Python 3.13:** `.pth` files flagged hidden are skipped. `scripts/check.sh` clears the flag, and pytest uses `pythonpath = ["src"]`.
- **`merge-seq.sh` on a gate failure.** The cherry-pick stays committed. Read the log it prints.
  - If the failure is infrastructure (port busy, a killed server, a flaky load-dependent timeout), re-run `scripts/check.sh` and continue with the remaining shas.
  - If the commit itself is at fault, `git reset --hard HEAD~1` and send it back for a fix.
- **Recharts 3.8.1 + React 19:** `isAnimationActive={false}` was reported to break client-side `<Link>` navigation on production builds. An e2e spec guards it; don't reintroduce it.
- **`REFRESH MATERIALIZED VIEW CONCURRENTLY`** stalled intermittently under the test suite's TRUNCATE/refill churn, so plain REFRESH is used, with `lock_timeout 5s`.
- **Perf database:** `bostadspriser_test_c_perf` (about 200k synthetic rows) is reused by `pnpm perf`. Drop it when no longer needed.
- **Guardrails, unchanged:**
  - Never run the live scrapers against hemnet.se or booli.se.
  - No bot-protection circumvention, lower delays or more concurrency.
  - Never touch `scraper/.state/`, `scraper/.cache/` or `.env`.
  - No destructive SQL on the dev DB.

## 5. Remaining plan to the stop conditions

1. Merge §2a → §2b → §2c, reviewing whatever is unreviewed.
2. Finish the open P1 rows in `docs/backlog.md`: F9 compare builder, F16, F19 error and loading states, F35, B14 ingest bounds, B15, and the B16 follow-ups.
3. P2: F21 (E part), F22 design tokens, F23 SEO, B22 `streetSlug`, F36–F38 and so on. Phase 4 (P3, optional): B28 only with evidence, B29 Dockerfile + cron (treat exit 75 as "skip, alert if it persists"; 78 should alert), F24, F25, and optionally the Next 16 / Prisma 7 upgrade.
4. **Audit rounds.** A fresh reviewer audits the current code without seeing earlier diffs. Triage its findings into new IDs. Stop after **two consecutive** rounds that find no new P0/P1 issues.
5. Write `docs/REPORT.md` (format in the original brief §6 "Final report"). Test counts so far:

   | | Baseline | ~last measured |
   |---|---|---|
   | pytest | 39 | ~476 |
   | web vitest | 0 | ~400 |
   | Playwright e2e | 0 | ~210 |
