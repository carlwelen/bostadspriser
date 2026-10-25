# F22 equivalent integration review

**APPROVE `8a666a6c759f495dfd7105e25b5424603764d3fb`.** No concrete findings or new backlog items. Merge this equivalent after `b2e1923`; skip original corrections `d65f6b2` and `b5027dd`.

Read AGENTS, HANDOFF, CLAUDE, reviewer brief, F22 acceptance, the actual parent diff, and prior readiness review. Source and main remained read-only. Execution used detached scratch `/tmp/review-f22-equivalent`, `TEST_DB_NAME=bostadspriser_test_r_f22eq`, and `E2E_PORT=3116`.

## Independent equivalence

- Actual parent: `b2e1923b58b319473c768b61417b08961982f473`.
- Both `8a666a6` and reviewed `b5027dd` resolve to full tree `e61803eb4b7aede173b0df1144f960c0bd3fced4`; their full-tree diff is empty.
- Independently generated binary diffs from `b2e1923` have identical SHA-256 `ab9e6a374a709eaadf3b5788ecd5f19afb00e7ba8f528e720ae2378ee17ce9c3`.
- The actual parent diff contains only the reviewed allocator/route correction, scatter-outline correction, regression tests/readiness wait, and evidence/screenshots. No extra implementation behavior was introduced by folding the commits.

[Independent proof](independent-equivalence.json); [reviewed source patch](reviewed.patch).

Commands from the repository:

```sh
git rev-parse 8a666a6^ 8a666a6^{tree} b5027dd^{tree}
git diff 8a666a6 b5027dd
git diff --binary b2e1923 8a666a6 | shasum -a 256
git diff --binary b2e1923 b5027dd | shasum -a 256
git diff b2e1923 8a666a6 -- web
```

## Fresh focused verification

Final unchanged source: production build/typecheck/lint succeeds, **5/5 allocator unit tests and 12/12 browser tests pass**, covering desktop and Pixel 7. The unit tests cover all 70 four-street/four-district interleavings, all 16 selected-district subsets at eight-series capacity, district identity, and street-only capacity. Browser tests verify mixed/street-only palette uniqueness, matching chips/legends/plotted strokes, consistent district identity across routes, and settled nonempty scatter contrast on all observations.

[Unit result](unit-final.log), [production build](build-final.log), [browser result](browser-final.log).

Commands:

```sh
git worktree add --detach /tmp/review-f22-equivalent 8a666a6c759f495dfd7105e25b5424603764d3fb
cd /tmp/review-f22-equivalent/web
pnpm install --frozen-lockfile
export TEST_DB_NAME=bostadspriser_test_r_f22eq E2E_PORT=3116
export DATABASE_URL=postgresql://bostadspriser:bostadspriser@localhost:5432/bostadspriser_test_r_f22eq
pnpm exec vitest run --project unit src/components/chartColors.test.ts
pnpm e2e:build
pnpm exec playwright test e2e/chart-colors.spec.ts
```

## Meaningful production reversion

**Yes, proving tests fail without the fixes.** Restored all three changed production files from `8a666a6^` while retaining the final tests. The parent renamed allocator API requires the following signature adapter so unit tests execute the old algorithm rather than merely failing on an absent export:

```ts
export function comparisonColors(ids: readonly string[]): string[] {
  return ids.map((id, index) => comparisonColor(id, index));
}
```

The route uses the exact restored parent `comparisonColor` implementation directly; the adapter does not affect browser production behavior. Parent production rebuild succeeds. The unchanged unit suite then has **3 semantic assertion failures, 2 passes**. The unchanged browser suite has **10 semantic assertion failures, 2 passes**:

- Each device observes 4 instead of 5 colors for the mixed five-series case, 6 instead of 8 for the mixed eight-series case, 4 instead of 5 for five streets, and 4 instead of 8 for eight streets.
- Both devices reach the original numeric contrast assertion and measure **2.3314369598202767 < 3** for `rgb(0, 114, 178)` fill with white stroke. No readiness/parser failure occurs.
- District-identity checks still pass on both devices, as expected.

[Exact executable probe](reversion-probe.py), [temporary production patch](production-reversion.patch), [unit failures](unit-parent.log), [parent build](build-parent.log), [browser failures](browser-parent.log), [exit codes](reversion-exit-codes.json). Execute with `python3 /tmp/r-f22-equivalent/reversion-probe.py`; the script contains every restoration and test command and restores all production files in `finally`.

## Gate, limits, cleanup

Independently inspected the supplied full-gate log: **542 Vitest, 344 Playwright, 759 pytest**, typecheck, zero-warning lint, production build, and Ruff pass. [Preserved source full gate](source-full-gate.log). This fresh review reran the focused unit/browser suites and production reversion; it did not rerun the unrelated full gate or the already-reviewed 40-run readiness stress test.

Existing optional F41 covers repeated colors beyond eight selected series; this equivalent adds no cap. The settled-paint wait retains positive table observation count, equal SVG mark count, four district fills, every-mark parsing, and the original 3:1 threshold. Production reversion confirms those waits do not mask deficient contrast.

Tracked scratch files were restored byte-for-byte to the reviewed commit before cleanup: [clean status](restored-tracked-status.txt), [verified hashes](restored-sha256.json). All owned test processes completed. The scratch worktree was then removed. No source/main edits, commits, pushes, protected files, live providers, dev database, or foreign process termination were used.
