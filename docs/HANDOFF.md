# Handoff: continuing the hardening loop

## Current checkpoint (2026-10-25, audit1 corrections)

- Live integration checkpoint: 95d51b1 -> 27bf79f, full gate green. Remaining approved queue: e8b0b04, 7f21875, a374e52, 0de29a4, 671722a, c396c2c, 9d670ed, 681cb6b, 492fdc0, b2e1923, 8a666a6, d9fcd9c, 69e3f2d. F20 original4257179 and test12d76ea are folded into fe86f8b to keep each merge green; skip both originals. See backlog for active reviews and later follow-ups.

This checkpoint supersedes the historical sections below. Read current backlog and verify Git/process state before resuming.

- Main: F45 e43485c → dd09d10, full519Vitest/298browser/764pytest GREEN in /tmp/main-f45-integration.log and /tmp/check-e43485c.log. Previous green ledger e8c1c98 (a8789bd →5a641bc). Published main remains b1730bb. This checkpoint records the green F45 integration. User authorizes GitHub pushes, superseding the original no-remote request.
- The comparison-removal failure is fixed and fresh-R APPROVED. Source F45 full543Vitest/352browser/764pytest; reviewer28focused+8restored checks and4semantic reversion failures. Report f45-comparison-removal-review.md. Earlier main baseline and wrapper13 failures are preserved in /tmp/main-audit-checkpoint-gate.log, /tmp/hardening-integration13.log and /tmp/main-f45-baseline-evidence. No retry of the unfixed race is required.
- After F45 main gate: update ledger, commit docs checkpoint, then run /tmp/hardening-integrate-next.py 991a460 023a8c2. No wrapper currently running. Queue:023a8c2,95d51b1,e8b0b04,7f21875,a374e52,0de29a4,671722a,c396c2c,9d670ed,681cb6b,492fdc0,b2e1923,then final F22 equivalent below. Gate and ledger after each source. Never run two integration wrappers.
- /tmp/hardening-publish-hold blocks automatic main pushes. Remove only after approved B57/B58 and the complete F12 group through e8b0b04 are integrated green; then publish that exact green ledger checkpoint. Never push a later HEAD while its gate runs. Remaining new audit fixes must be appended after approval.
- Audit1 COMPLETE on immutable582efba:0P0/2P1/6P2; consecutive clean P0/P1 rounds0. Report docs/review-probes/whole-audit-1.md and adjacent coverage inventory. Findings B57–B62/F43/F44 assigned; F45 came from integration gates. Correct/review/integrate all mandatory findings, then fresh whole-code audits until two consecutive clean P0/P1 rounds.
- B57=023a8c2 APPROVED/pushed on hardening/b-cluster-invalidation. Source543/348/786, reviewer803pytest and29semantic reversion failures. B63 optional tracks measured matcher correction cost. B58=95d51b1 APPROVED, reviewer801pytest/23independent probes and14committed reversion failures. B61=d9fcd9c APPROVED, reviewer160focused/probes with separate selection/flush/preservation reversions. B58/B61 pushed to hardening/b-future-coverage-reviewed. Reports b57-cluster-correction-review.md, b58-future-coverage-review.md, b61-incomplete-coordinate-review.md.
- B62Python resumed with approvedF45 dependency66ce1b1; fullgate/commit pending: /tmp/bostadspriser-hardening-b-future, hardening/b-future-coverage, head d9fcd9c, test_b58/3103. Uncommitted patch /tmp/b62-python-checkpoint.patch.872pytest green, ruff green. Includes finite complete-pair normalization, raw nonfinite JSON preservation, invalid legacy cleanup, and finally-refresh after committed cleanup including generic/config failures. Test-first evidence /tmp/b62-cleanup-publication-red.log and /tmp/b62-cleanup-selection-red.log. Resume agent with approvedF45 dependency when slot frees, then fullgate and commit; fresh R required.
- C active: /tmp/bostadspriser-hardening-c-audit, hardening/c-audit-corrections, test_c_audit/3107. B59=0885683(full547/348/764) awaits freshR. B60 uncommitted sign filter/copy/tests/screens; first gate failed onlyF45. Agent now may cherry-pick approved e43485c dependency, gate/commit B60, then apply /tmp/c-audit-b62.patch and finish B62SQL. Merge only task commits, not dependency again. B62 uses global finite inclusive bounds, not a new Stockholm-only policy.
- E active: /tmp/bostadspriser-hardening-e-audit, hardening/e-audit-corrections, test_e_audit/3105. F45=e43485c approved and pushed to hardening/e-audit-reviewed. F44 responsive cards:8red/12controls,58focusedbrowser green; fullgate /tmp/e-audit-f44-gate.log running. Fresh R after commit.
- F43=69e3f2d APPROVED/pushed hardening/d-map-visibility; /tmp/bostadspriser-hardening-d-map-visibility. Source554/348/764, reviewer65uniqueunit/56browser,6/11production-reversion and9/16camera-mutation failures. Report f43-map-visibility-review.md. Screens verify controls with missingtoken; no live Mapbox/WebGL verification. Integrate task only, never582efba parent.
- Final E source throughb5027dd is approved/pushed. F21 main replacement681cb6b APPROVED(full535/322/764; R60unit34browser/8reversion failures), skiporiginal7b5e461 and preparationf8c63d8. After681:492fdc0,b2e1923,then8a666a6 once review passes.8a666a6 folds d65f6b2+b5027dd into one green correction; /tmp/bostadspriser-e-f22-integration, integration/e-f22-correction, full542/344/759. Its treee61803eb exactly equals b5027dd; proof /tmp/e-f22-equivalence-proof.txt. Fresh R APPROVE5unit12browser,3unit10browser semantic reversion failures; report f22-equivalent-review.md. Wrapper now uses8a666a6 thenapprovedB61d9fcd9c/F4369e3f2d; skips both originals.
- Original D/docs queue fully reviewed. Use F37 equivalenta374e52, skip5363f4b. c396c2c and9d670ed are actual docs tasks. Other folded originals:4257179+12d76ea→fe86f8b; acd9acb→991a460. Never integrate preparation1426915,3a2494a,16b4629,96bcc91,f987cf7,f125002,512d50e,c896c75,582efba,f8c63d8.
- Immutable auditcandidate remains /tmp/bostadspriser-final-candidate, integration/final-candidate,582efba8d1db9745434bb58806e3d8e0db0520d4, clean; full543/348/764 but contains audit1 defects. Prepare corrected successor from approved task commits, gate and audit. Final main runtime/test tree must match final audited successor. Never merge candidate preparation snapshot to main.
- Max3subagents: implementers gpt-6.1-sol; reviewers gpt-6-astra, fresh context/read-only. Current slots B62, C B60/B62, E F44 finishing; freshR F44 next. F22equivalent review approved. Goal remains active. Root owns main test/3100. Do not start duplicate gates or kill foreign processes.
- Finish: all unblocked mandatory P1/P2 reviewed/integrated; two consecutive fresh clean P0/P1 audits; final code match; docs/REPORT.md; final fullgreen gate and verified GitHub push. /tmp/REPORT.hardening-draft.md is a detailed draft only. B16 remains BLOCKED: needs owner decision; P3 optional. No live providers, protected files or dev-data mutations. Root-owned caffeinate session18284/PID60535 runs12hours; provider/runtime continuation cannot be guaranteed, so preserve exact state. No approval prompts.

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
