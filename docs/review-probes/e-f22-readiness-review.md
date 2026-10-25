# Fresh R review: final F22 readiness correction

**APPROVE `b5027ddc9aab62f13af2c28f1b5d29230a8e753b`. Cumulative F22 merge verdict: APPROVE** for `492fdc0` + `d65f6b2` + `b5027dd`, in their dependency order. No remaining concrete findings. F21/F23 approvals are unchanged by this test-only follow-up.

Reviewed immutable source on `hardening/e-analytics-final`; parent is exactly `d65f6b2881825eb57ea7cd7049b56f4a1eddd14f`. Main and implementer checkouts were read-only. All execution and temporary mutation used `/tmp/review-e-readiness-final`, `TEST_DB_NAME=bostadspriser_test_r_e_ready`, and `E2E_PORT=3116`.

## Scope and assertion integrity

The entire diff is nine additive lines in `web/e2e/chart-colors.spec.ts` and 21 documentation lines. Production blobs are unchanged; [production diff](production-diff.txt) is empty. The [test patch](readiness.patch) retains the original color-channel parser, every rendered mark, four distinct district fills, composited fill/outline contrast >=3, and the empty-console assertion. There are no skips, catches, relaxed thresholds, or removed assertions.

Readiness now requires network settlement, a positive observation count from every `tbody tr`, the same number of SVG marks, the first mark visible, and RGB fill/stroke on every mark before parsing. `PriceAreaScatter` supplies one table row per input observation; `ChartDataTable` renders all rows without pagination. The waits therefore exercise a nonempty full fixture, rather than allowing an empty `every()` to pass the test. Subsequent category and contrast assertions remain required.

## Independent reproduction and verification

- Unchanged final chart-color suite: **12/12 pass**, desktop and Pixel 7. [Log](chart-suite.log).
- Unchanged final scatter test, `--repeat-each=20` across both projects: **40/40 pass**, 20 desktop and 20 Pixel 7. [Log](contrast-repeat.log).
- Restore only the test file to `d65f6b2`, keeping final production unchanged: **10/10 mobile runs fail with the original `null.slice` parser exception**. This independently reproduces the readiness defect, not a color defect. [Log](old-readiness.log).
- Restore the final test; temporarily change only the production scatter outline from its district color to white, then rebuild. Both desktop and mobile fail the **original numeric contrast assertion**, measured **2.3314369598202767 <3**, with `rgb(0, 114, 178)` fill and `rgb(255, 255, 255)` stroke. Readiness succeeds, demonstrating that it does not mask low contrast. [Mutation](white-outline.patch), [build](white-outline-build.log), [test failures](white-outline-contrast.log).
- Restore immutable final production and rebuild: **2/2 scatter cases pass** again. [Build](restored-build.log), [test log](restored-contrast.log). Tracked scratch status is clean: [status](restored-tracked-status.txt).

The exact reviewer probe implementation is [probes.py](probes.py); [exit codes](probe-exit-codes.json) and [run log](probes-run.log) record each step. The unchanged final test SHA-256 is `8eede2ed992f971d02c067922fca4b6079c45ed334dbeb001e3d8f45f563cafd` before and after the probes.

Commands used for the main independent runs (from scratch `web/`, with the isolation environment above):

```sh
pnpm exec playwright test e2e/chart-colors.spec.ts
pnpm exec playwright test e2e/chart-colors.spec.ts -g 'scatter observations' --repeat-each=20
pnpm exec playwright test e2e/chart-colors.spec.ts -g 'scatter observations' --project=mobile --repeat-each=10
```

The last command uses the parent test; mutation and restored-final runs use the final test with the production variants described above. Every production variant is built using `pnpm e2e:build`.

## Cumulative acceptance and gate

The prior [fresh production review](/tmp/r-e-color-final/REPORT.md) remains applicable because production is byte-identical. It independently verified 7,209 valid allocations through eight series, stable district identity, rendered plot/chip/legend/tooltip agreement, and all four opaque scatter outlines with minimum contrast 3.0610. Its sole remaining blocker was test readiness, now independently reproduced and resolved. The mutation above preserves its meaningful original production contrast failure.

Verified the source's final full gate: **542 Vitest, 344 Playwright, 759 pytest**, plus typecheck, zero-warning lint, production build, and Ruff. [Preserved full-gate log](e-f22-race-check.log). Source readiness evidence is also preserved: [9/10 old-test failures](e-f22-race-red.log), [40/40 final repeats](e-f22-race-green.log). Reviewer rebuilt production and ran the focused suite, repeats, reversion, and mutation rather than redundantly running the unchanged backend gate.

No new backlog item. Existing optional F41 covers color reuse beyond eight selected series; no product cap is introduced or requested.

No live providers, protected files, dev database, commits, pushes, or unrelated process termination were used. All owned test processes completed. Scratch tracked files were restored before cleanup.
