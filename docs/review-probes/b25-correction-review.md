# B25 correction review

Source: `671722a1cab12ef7f1d196579099888b3712c614`, parent `0de29a4`.
Reviewed application: combined base `f125002cd8a3a5056112bf9ae0878aba81578fa2` plus the source correction, in detached scratch `/tmp/review-b25-correction`.
Final combined commit: `512d50e6fbe6ec76b6f3cfc2be6712e3f25d35bf`. Verified parent is the tested base; all 20 changed blobs exactly match the source correction, including the four tested production/test blobs. Identity evidence: `identity.json`.

Verdict: **APPROVE**. No findings. F12 is outside this review. No new backlog IDs.

## Evidence

- Production reversion is meaningful. Restored only `web/src/components/HeatmapMap.tsx` from `f125002` (same B25 production file as source parent), retained the new regression tests, rebuilt, and ran `pnpm exec playwright test map-truncation.spec.ts -g 'short tablet' --project desktop`. Both cases fail at the intended geometry assertion: capped card top 34.90625 and uncapped 68.21875, versus map top 85.28125. Logs/traces: `red-build.log`, `red-browser.log`, `red-results/`.
- Restored corrected production file, rebuilt with empty `NEXT_PUBLIC_MAPBOX_TOKEN`. `pnpm exec vitest run --project unit src/components/map/heatmapTruncation.test.ts`: **5 passed**. Covers honest cap count, loading/error/empty selection and stale response cancellation.
- `pnpm exec playwright test map-truncation.spec.ts reviewer-b25.spec.ts`: **24 passed** layout/input checks. The two independent state tests initially failed solely because the reviewer selected both the application alert and Next's route announcer; corrected the locator and reran only those checks: **2 passed** (`state-browser.log`). Production code unchanged. Initial harness failure traces remain in `green-results/`.
- Independent checks use actual production rendering with hermetic network and no Mapbox token. At 820×400 and 768×400, capped and uncapped: card, notice and badge fully inside the visible map, mutually nonoverlapping; heading/first row visible initially; all five complete rows become visible and pass hit testing through wheel, actual Tab + Home/ArrowDown, and CDP touch drags in the mobile project.
- Both widths/projects: map y 85.28125–387; notice ends 157.28125; card starts 169.28125. Capped card ends 305.6875, badge starts 317.6875; uncapped card ends 339, badge starts 351. Scroll content 271 px; card client height 136 px capped /170 px uncapped. Initial and scrolled PNGs plus geometry JSONs retained.
- Independent 1280×720, 390×844 and 667×375 checks pass in both projects: notices/badge remain inside the map with no overlap or horizontal document overflow; desktop rows all fit; phone card stays intentionally hidden.
- Independent real-fetch lifecycle probe passes both projects: initial pending, capped response, loading after selection change, newer uncapped response before stale capped response, error clearing the card/cap, successful retry and deselection ignoring an in-flight response.

All test commands used `TEST_DB_NAME=bostadspriser_test_r_b25 E2E_PORT=3115`. No existing checkout edited, no commits/pushes, live scraper/Mapbox calls, protected files or dev DB operations. Root full combined gate is green (confirmed `/tmp/final-candidate-b25-gate.log`); reviewer ran focused production build/unit/browser checks. Reviewer scratch worktree was removed after preserving evidence. Probe source is `reviewer-b25.spec.ts`.

## Reviewed blob identities

- HeatmapMap.tsx: `8c9c334e9f144af3cabc92d9449581bfe806ca2e`
- HeatmapMap.module.css: `e9c13af0487fe8a18026479100aefc027db379be`
- map-truncation.spec.ts: `1ebfe34f4ab342377bf42099e23e63083566599f`
- heatmapTruncation.test.ts: `1ee870427cb4a5c0e0fce3443cab131df260fc99`
