# Handoff: continuing the hardening loop (for Codex or any other agent)

## Current checkpoint (2026-10-24)

- Live integration checkpoint: 904857a -> bef65d0, full gate green. Remaining approved queue: 9c413cc, e56eb08, ccc3b70, 2a7deec, 011bd0d, 2e4a733, 6a2de79, 76919c1, adf2f95, 7ef637d, be51bfc, 772ab13. F20 original4257179 and test12d76ea are folded into fe86f8b to keep each merge green; skip both originals. See backlog for active reviews and later follow-ups.

This supersedes the historical handoff below. `docs/backlog.md` is the live merge ledger and work queue.

- **Published main: a8b6d0f.** All original B/C/E handoff work is integrated. All C follow-ups through dba781b are also integrated, with a full gate after every merge. Latest code merge dba781b -> de7a9f4. The next reviewed batch is B, then E's first three follow-ups, then the earlier D/A fixes.
- **Folded integrations—do not reapply originals:** E4257179 and test-only12d76ea became reviewed-equivalent fe86f8b -> bc19d7e. Cacd9acb plus the three required median fields in the existing typed MoM test fixture became991a460 ->1cdf2d9. `git cherry` may still show the originals as `+`; skip them.
- **Approved B queue, oldest first:**6925f14,220a0b7,5024ea3,79c9406,3012848,fea8329,904857a,9c413cc,e56eb08. B14 ingestion bounds, B15 offline evidence, B49 cache notification, B23 vectors, B45 durable DB state and B36 opt-in prune are fresh-review approved and published on hardening/b-scraper / hardening/b-scraper-next. No actual pruning or live scraping was run.
- **Approved E follow-ups:**ccc3b70(F35),2a7deec(F16),011bd0d(B14 median MoM). E7dfd56d(F9) and fb05162(F19) received CHANGES REQUESTED. Correctionsa2009cd(F9) and8001be3(F19) are fully green and now in fresh R2 /root/r_e_corrections2 review (test_r_e2/3116). F19 passes10 actual failure/restoration/recovery probes. Re-review both before integration. E then continues F21/F22/F23. Evidence:docs/review-probes/e-f9-f19-review.md.
- **Approved earlier D/A queue:**2e4a733(B23),6a2de79(B53),76919c1(F38),adf2f95(F19),7ef637d(B53),be51bfc(F40),772ab13(B53). Publish the B53 stack as a complete group. Evidence:docs/review-probes/b36-b53-review.md.
- **New D batch in fresh review:**7cb4a17(F11),c0553f8(F12),ceb3d11(B14) on hardening/d-map-phase3 at /tmp/bostadspriser-hardening-d;7f21875(F36),5363f4b(F37),0de29a4(B25 UI) on hardening/d-map-phase4 at /tmp/bostadspriser-hardening-d-next. F11/F12 are paired. Root's combined /tmp/bostadspriser-d-ui-integration (integration/d-ui,test_d_join/3107) is immutablef987cf7, fully green514vitest290e2e488pytest. StreetSearch conflicts preserve both real links and median values, plus both test additions. Fresh R /root/r_d_ui_batch approvesF11/B14/F36/F37; requestsF12 dense-tooltip andB25 short-tablet clipping fixes. Root F12 correction passes8/20/200 records with desktop/mobile wheel/keyboard/touch access and gates now. D B25 follow-up next; fresh re-review required.
- **Automation:** /tmp/hardening-integrate-next.py runs scripts/merge-seq.sh one source at a time, gates, updates the ledger and pushes complete green groups. Resume after this checkpoint with `python3 /tmp/hardening-integrate-next.py 991a460 79c9406` after removing /tmp/hardening-integration-stop. Its queue covers the approved B/E/D lists above. A failure preserves the failed own commit and restores green main when safe. Confirm actual logs/git state before resuming; do not run two integration wrappers together.
- **Preparation bases are not task commits:**1426915,3a2494a,16b4629,96bcc91 and the upcoming combined D review base. Cherry-pick the task commits listed in the ledger. Main F37 integration will need the same median/link conflict resolution already prepared in the combined D candidate; gate the equivalent replacement before integration if needed.
- The user superseded the original no-push instruction and explicitly authorized GitHub pushes and unattended work. Root publishes reviewed green checkpoints to github.com/carlwelen/temp; workers never push. A continuing goal is active. Approval policy is `never`, full access; omit sandbox_permissions. A stuck pending-init agent consumes one slot, so at most two additional workers run alongside root.
- **Audit rounds:0.** Mandatory P1/P2 review/integration and two consecutive clean P0/P1 audits remain, then docs/REPORT.md. B16 Mapbox storage terms remains BLOCKED: needs owner decision, with recommendation in the backlog. P3 is optional. A CLAUDE.md update draft is saved at /tmp/CLAUDE.hardening.md; apply only after its described B changes are integrated and validate against final code. Rate-limit/app-shutdown recovery cannot be guaranteed; preserve exact checkpoints.

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
