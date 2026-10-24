# Adversarial UI review

Reviewed immutable source batches ceb3d11 / 0de29a4 and combined candidate f987cf7a4516e482f23477c5cd4dc7603240d2bc. Root's later fixes are outside this verdict.

| ID | Verdict |
|---|---|
| F11 | APPROVE |
| F12 | CHANGES REQUESTED |
| B14 | APPROVE |
| F36 | APPROVE |
| F37 | APPROVE |
| B25 UI | CHANGES REQUESTED |

## Required corrections

1. **Major — F12**, `web/src/components/map/DrawerTooltip.tsx:25,32` (used at `AddressDrawer.tsx:244`). All same-day sales are rendered as unbounded tooltip blocks. With eight records the tooltip is 410px tall, y409.53–819.53 on a 1280×720 viewport, clipping the final observations below the drawer. Twenty records also exceed mobile height. SVG observations remain present; the defect is inaccessible tooltip content. Bound the tooltip to its available viewport/drawer space and make every record reachable with actual pointer/touch and keyboard interaction; don't silently discard records. The source-eight probe and original failure trace are preserved in `reviewer-d-ui.spec.ts` and `batch1-browser-results/`; the final combined twenty-record reproduction is separately preserved below.

2. **Major — B25**, `web/src/components/HeatmapMap.tsx:393,421`. At 820×400 with five returned sales and `truncated=true`, wrapping the recent-sales card above the notice places its top at y34.91 although the map begins y85.28. The map's overflow clips the heading and first sale. This is introduced by wrapping: the former standalone 270.78px card would fit at y104.22. Account for available height as well as width (bounded/scrollable card or appropriate compact presentation) and preserve honest capped copy. Test short tablet / wide-phone landscape dimensions, not only height700. `reviewer-phase4.spec.ts` first test reproduces it in both configured browser projects.

No additional backlog IDs needed: both findings are within the reviewed acceptance criteria.

## Proving tests / production reversion

All commands ran only in detached reviewer scratch, with TEST_DB_NAME=bostadspriser_test_r_d_ui and E2E_PORT=3115. No live scrapers / Mapbox or dev database used.

- F11: restored AddressDrawer from 7cb4a17^; `pnpm exec vitest run --project unit src/components/AddressDrawer.chart.test.ts -t F11`: **4 failures**, elapsed-time spacing and day/week/month gap paths.
- F12: restored AddressDrawer/drawerSeries from 7cb4a17; same suite `-t F12`: **2 failures**, sparse dots and visible tooltip.
- B14: restored AddressDrawer/drawerSeries/DrawerTooltip/StreetSearch from c0553f8; chart+tooltip suites `-t B14`: **4 failures**, SQL summary/median assertions.
- F36: restored pre-7f21875 layout/search plus compatible pre-F37 modal sources, rebuilt; `pnpm exec playwright test short-viewport.spec.ts`: **4 failures**. Map height110.3125 instead of >=180; search bottom339 beyond320.
- F37: restored pre-5363f4b AddressDrawer/StreetSearch/focusTrap; `pnpm exec vitest run --project unit src/components/map/modalStack.test.ts -t F37`: **3 failures**, inert/lower removal/IME guards.
- B25: restored HeatmapMap from5363f4b; `pnpm exec vitest run --project unit src/components/map/heatmapTruncation.test.ts`: **4 failures**, notice/state assertions (1 absence-only test still passes).

Original batch1:219 unit tests passed. Batch1 browser checks:29 passed /1 dense-desktop finding. Both ordinary chart probes verified every street count, sparse rings, visible tooltips, honest x-spacing1/18 and broken missing-month curve. Same-day SVG records preserved. SQL drawer summary is consumed directly, with no client aggregation; SQL count uncapped and median default are retained. SQL bucket median and search median regressions pass.

Original batch2:14 focused unit tests passed. Browser run:46 passed,2 short-tablet finding failures,2 reviewer harness locator mistakes (period pills have role=tab, not button); the latter were corrected for the combined run. Existing short-viewports, synthetic visual-viewport keyboard resize, keyboard search, IME, native modified clicks, B25 transitions and tablet-height700 geometry all passed. Independent actual middle click opened a new page while keeping search open.

## Combined resolution

Inspected f987cf7 against both sources: StreetSearch preserves the native Link and median/title plus both appended test sets. AddressDrawer changes from ceb3d11 only in the intended top-modal focus restoration. No resolution defect found. Final combined browser evidence below confirms findings and corrected independent modal probe.

Final combined f987cf7 run: `pnpm exec playwright test reviewer-d-ui.spec.ts reviewer-phase4.spec.ts` => **8 passed /4 expected finding failures**. Dense20 tooltip clips in both desktop and mobile; short820×400 capped card clips in both. Passed both projects: ordinary chart geometry/tooltip content, real middle-click new-page navigation, real keyboard Tab/Shift+Tab modal trapping and focus restoration, removal of lower drawer without stealing search focus, and keyboard last-result/close reachability in568×320. Logs: `r-d-ui-combined-browser.log`; complete traces: `combined-browser-results/`; regenerated original-candidate screenshots/geometry: `r-review-original-*.png/json`. Original no-longer-reliable root `/tmp/r-d-ui-*.png/json` files were overwritten by a separate root correction run; final artifacts here use independent names and were regenerated on immutable f987cf7.

Probe code is included as files in this evidence directory. `reviewer-d-ui.spec.ts` retains the first eight-record reproduction; `reviewer-combined-d-ui.spec.ts` has the final twenty-record fixture (street count20); `reviewer-phase4.spec.ts` includes corrected role=tab selector; `fixture-page.tsx` is the temporary page harness. No test-harness pages were added to production or committed. Scratch worktree removed after saving evidence.
