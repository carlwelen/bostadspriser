# F22 correction evidence

Correction to reviewed commit `492fdc0`, on top of E batch head `b2e1923`.
Fresh review: `/tmp/r-e-final/report.md` (F21/F23 approved; F22 changes requested).

`comparisonColors` reserves every selected district's fixed identity before
allocating streets. Streets prefer the four separate tones, then use absent
district tones. Any selection of at most eight loaded series has distinct colours,
independent of district/street ordering. Missing streets are removed before
allocation. Legends, selected chips and rendered line strokes share the result.

Scatter observations retain translucent fills and now have opaque outlines in
their district colour. Actual computed fill/outline contrast is checked against
white in the production browser; all four outlines meet 3:1 (minimum 3.06:1).

## Failing-first evidence

- Original production build: two streets interleaved among three districts have
  only four unique colours across five series; four streets interleaved among all
  four districts have six colours across eight series. Both cases fail on desktop
  and Pixel 7. Log: `/tmp/e-f22-red.log`.
- Original scatter rendering fails the composite fill/outline test on both
  devices (first point 2.3314:1, white outline).
  Log: `/tmp/e-f22-scatter-red.log`.
- An intermediate street-ordinal-only fix still repeats after four streets.
  Five/all-eight street-only browser comparisons fail on both devices; capacity
  and district-reservation unit tests fail too. Logs:
  `/tmp/e-f22-capacity-browser-red.log`, `/tmp/e-f22-capacity-red.log`.

## Final checks

- `web/src/components/chartColors.test.ts`: all 70 interleavings of four streets
  and four districts; all 16 selected-district subsets at eight-series capacity;
  fixed district identity; all eight street-only tones before cycling.
- `web/e2e/chart-colors.spec.ts`: desktop and Pixel 7 production checks for the
  mixed five/eight-series cases, five/all-eight streets, plotted strokes matching
  legend and chip colours, and computed scatter fill/opacity/outline contrast.
- `TEST_DB_NAME=bostadspriser_test_e E2E_PORT=3105 scripts/check.sh` passes:
  542 Vitest, 344 Playwright, 759 pytest, typecheck, zero-warning lint, production
  build and Ruff. Log: `/tmp/e-f22-check-final.log`.
- Desktop/mobile screenshots use the `F22-correction-` prefix in `docs/screens/`.

## Test readiness follow-up

The next immutable review found a race in the supplied contrast test: the first
visible scatter mark can precede the final computed fill/stroke paint on other
marks. Parsing a transient non-RGB value raised `null.slice` before contrast could
be checked. Production rendering passed the independent review probes.

- Unchanged `d65f6b2` test reproduced the failure in nine of ten Pixel 7 repeats:
  `pnpm exec playwright test e2e/chart-colors.spec.ts -g 'scatter observations'
  --project=mobile --repeat-each=10`.
  Log: `/tmp/e-f22-race-red.log`.
- The follow-up waits for network settlement, every observation represented in
  the chart-data table, and RGB fill/stroke paint on every mark. It retains the
  full observation set, all four district fills, and the original composited 3:1
  contrast assertions. No production code changes.
- The same production contrast test then passes 20 consecutive desktop runs and
  20 consecutive Pixel 7 runs (`--repeat-each=20`, both projects).
  Log: `/tmp/e-f22-race-green.log`.
- Full gate passes again: 542 Vitest, 344 Playwright, 759 pytest, typecheck,
  zero-warning lint, production build and Ruff. Log: `/tmp/e-f22-race-check.log`.

## Inherited limitation: F41

The selector remains unlimited. More than eight selected series can reuse
colours, as before F22. Pattern/shape fallbacks with matching legend and chip cues
are separate optional P3 work tracked by the orchestrator as F41. This correction
does not introduce a series cap or change chart/tooltip interaction.
