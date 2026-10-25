# Handoff: continuing the hardening loop

## Current checkpoint (2026-10-25, all correction reviews approved)

- Live integration checkpoint: e8b0b04 -> 473caf7, full gate green. Remaining approved queue: 7f21875, a374e52, 0de29a4, 671722a, c396c2c, 9d670ed, 681cb6b, 492fdc0, b2e1923, 8a666a6, d9fcd9c, 69e3f2d. F20 original4257179 and test12d76ea are folded into fe86f8b to keep each merge green; skip both originals. See backlog for active reviews and later follow-ups.

This checkpoint supersedes the historical sections below. Read current backlog and verify Git/process state before resuming.

- Main published checkpoint remainsb1730bb until the F12 group finishes. Original B/C/E handoffs are complete. F45=e43485c→dd09d10 full519Vitest/298browser/764pytest; checkpoint9a225f6. B57=023a8c2→95683c3 andB58=95d51b1→27bf79f are now integrated with fullgreen gates and ledger commits. Source-to-main mappings are in backlog.
- Main integration wrapper14 is /tmp/hardening-integrate-next.py, log /tmp/hardening-integration14.log, root session67093. /tmp/hardening-integration-stop is PRESENT: it will stop after green e8b0b04 and its ledger. On completion, verify clean/green HEAD, remove /tmp/hardening-publish-hold and publish that exact checkpoint; B57/B58 and complete F12 group will then be integrated. Never push a newer HEAD whose gate is still running.
- Resume next with HARDENING_NO_FINAL_PUSH=1 python3 /tmp/hardening-integrate-next.py 991a460 7f21875 after removing stopflag. Never run two wrappers. Script queue has been extended since wrapper14 started, so this restart is required. Remaining approved order:7f21875,a374e52,0de29a4,671722a,c396c2c,9d670ed,681cb6b,492fdc0,b2e1923,8a666a6,d9fcd9c,69e3f2d,1b3c70e,4825985,0885683,20daae3,00647b0. Full gate and ledger per source; complete groups auto-push only when publishhold absent. All listed tasks have fresh-R approval.
- Audit1 COMPLETE on immutable582efba:0P0/2P1/6P2; consecutive clean P0/P1 rounds0. Report docs/review-probes/whole-audit-1.md and coverage inventory. Findings B57–B62/F43/F44 corrected and reviewed; F45 came from integration gates. Fresh whole-code audits remain until two consecutive rounds with no new P0/P1. OptionalF46/F47 from F44 review are baseline no-JavaScript/enlarged-font extensions, not mandatory blockers.
- Corrected candidate is PREPARATION ONLY: /tmp/bostadspriser-audit-candidate-2, integration/audit-candidate-2, parent582efba. Staged task commits023a8c2,95d51b1,d9fcd9c,69e3f2d,e43485c,4825985,1b3c70e,0885683,20daae3,00647b0; db.py merged automatically. Fullgate /tmp/audit2-candidate-gate.log, session52512, TEST_DB_NAME=bostadspriser_test_final2 E2E_PORT=3108. Aftergreen, commit one preparation snapshot and launch fresh gpt-6-astra whole-code audit2. Never merge preparation snapshot to main. Candidate582efba already contains all earlier D/E/docs fixes, so do not reapply equivalentF21/F22 patches there. Final main runtime/test tree must match final audited candidate.
- All task reviews COMPLETE, no implementers active. B57 approved report b57-cluster-correction-review.md; B58 b58-future-coverage-review.md; B61 b61-incomplete-coordinate-review.md. B62Python=1b3c70e, source543/352/872; R872existing+46independent and71production/9CLIreversion failures, report b62-python-coordinate-review.md. C B59=0885683/B60=20daae3/B62SQL=00647b0 allapproved; latestsource557/352/764, R309Vitest/6browser,19semantic reversions, report c-audit-sql-review.md. B62Python finally-refresh covers all committed cleanup including generic/config failures and preserves original errors; rollback never reports committed cleanup.
- UI approvals: F43=69e3f2d source554/348/764, R65unit56browser and visibility/camera reversions, report f43-map-visibility-review.md. F44=4825985 source543/372/764, R48relevantbrowser/28restored with committed/SSR reversions, report f44-summary-card-review.md. F45=e43485c alreadyintegrated, report f45-comparison-removal-review.md. F43 images verify controls with an emptytoken, not live Mapbox/WebGL.
- Final E integration: F21 equivalent681cb6b approved, skip7b5e461/preparationf8c63d8. After681 use492fdc0,b2e1923,8a666a6. The last folds d65f6b2+b5027dd; treee61803eb exactly matchesb5027dd, full542/344/759, freshR5unit12browser and3unit10browser reversion failures. Report f22-equivalent-review.md; /tmp/e-f22-equivalence-proof.txt. Skip both folded correction originals. All original finalE source throughb5027dd was already pushed.
- Published reviewed branches include hardening/d-map-phase3, hardening/d-map-phase4, hardening/b-refresh-failure, hardening/d-map-visibility, hardening/b-cluster-invalidation, hardening/b-future-coverage-reviewed(1b3c70e push pending verification), hardening/e-audit-reviewed(4825985), hardening/e-f22-reviewed(8a666a6). C audit branch publication can now proceed. User authorizes GitHub pushes, superseding the original no-remote request; only root pushes.
- Source worktrees: B /tmp/bostadspriser-hardening-b-future(head1b3c70e; dependency66ce1b1 is F45, skip); C /tmp/bostadspriser-hardening-c-audit(head00647b0; dependency6d39305 is F45, skip); E /tmp/bostadspriser-hardening-e-audit(head4825985); F43 /tmp/bostadspriser-hardening-d-map-visibility(head69e3f2d); F22equivalent /tmp/bostadspriser-e-f22-integration(head8a666a6). All clean. Original audit1candidate /tmp/bostadspriser-final-candidate remains582efba, clean.
- Never integrate preparation1426915,3a2494a,16b4629,96bcc91,f987cf7,f125002,512d50e,c896c75,582efba,f8c63d8 or new audit snapshots. Other folded originals:4257179+12d76ea→fe86f8b; acd9acb→991a460;5363f4b→a374e52. c396c2c/9d670ed are actual reviewed docs task commits.
- Finish: all unblocked mandatory P1/P2 integrated; two consecutive fresh clean P0/P1 audits; final code match; docs/REPORT.md; final fullgreen gate and verified GitHub push. /tmp/REPORT.hardening-draft.md is only a draft. B16 remains BLOCKED: needs owner decision; P3 optional. Max3subagents, implementersgpt-6.1-sol and freshread-only reviewersgpt-6-astra. Main test/3100; candidate2test_final2/3108; allocate unique reviewer DB/port. No live providers/protectedfile edits/devdata mutations. Root-owned caffeinate session18284/PID60535 runs12hours; continuation across provider/runtime limits cannot be guaranteed, so preserve exact state. No approval prompts.

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
