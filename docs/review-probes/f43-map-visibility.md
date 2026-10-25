# F43 map layer visibility

The mounted component now reapplies mode/checkbox visibility after point and hex layer creation. Camera transitions retain their original control dependencies, so receiving replacement data does not reset the user's view.

`web/src/components/HeatmapMap.visibility.test.tsx` exercises the real React effects with a fully offline Mapbox API stub and real h3 aggregation. Eleven cases cover both initial load orders, both modes, both checkbox states, controls changed during loading, district deselection/reselection, failed filter requests, and the real retry button. Assertions verify exact layer sets and visibility, plus unchanged camera-call counts during data changes.

Failing-first evidence: the original two delayed-data tests failed with visible layers while hidden. The expanded suite passed11/11 after the production change; restoring only HeatmapMap.tsx to its parent produced6 semantic failures and5 passing controls. Logs: `/tmp/d-f43-red.log`, `/tmp/d-f43-expanded-green.log`, `/tmp/d-f43-expanded-red.log`.

The screenshot captures use the standard hermetic production server with an empty public map token. They verify the Swedish controls/layout for hidden price/frequency modes on desktop/mobile; they do not show or verify Mapbox/WebGL rendering. The offline component tests verify the layer API visibility contract. No provider requests were made.

Full gate: **554 Vitest / 348 Playwright / 764 pytest**, all green, plus typecheck/lint/build/ruff (`/tmp/d-f43-full-gate.log`). Standard screenshot capture passed4/4. Four additional control captures assert the unchecked heatmap box and selected mode after scrolling the existing filter pane; all passed and were visually inspected. The committed `F43-controls-*.png` files show these controls. Capture probe and logs are preserved under `/tmp/d-f43-controls-*`.
