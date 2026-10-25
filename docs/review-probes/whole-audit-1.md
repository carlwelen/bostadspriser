# Fresh whole-code audit — round 1

**Candidate:** `582efba8d1db9745434bb58806e3d8e0db0520d4`, `/tmp/bostadspriser-final-candidate`, integration/final-candidate. Audited current source, not a patch. No historical review reports were used as a scan plan. Process documents and authoritative main backlog were read for scope, acceptance and guardrails. Candidate/source and main were not edited.

**Disposition: changes required. New P0: 0; new P1: 2; new P2: 6. This is not a clean P0/P1 round.** B57, B58 and F43 have already been assigned by root during this audit; other proposed IDs below await the ledger. No new P3 finding is claimed. These results concern the immutable candidate, not fixes prepared concurrently elsewhere.

## Findings

### B57 — P1 — Explicit correction commands publish stale fuzzy clusters

- Locations: `scraper/src/scraper/run.py:254`, `:316`, `:547`; retained facts are written by `db.py:157` and `reparse.py:103`. The effective dedup view gives an existing `clusterId` priority over the corrected `dedupKey`.
- Reproduction: seed Hemnet h at 4,900,000 and Booli b at 4,905,000, same Brahegatan 3A/date/area/rooms. `match_clusters()` produces one canonical sale. A fixture-backed `scrape` or `backfill` corrects h to 6,000,000 using its existing sourceId; independently, `reparse` derives that correction from raw. Each CLI command exits 0 and refreshes the snapshot. Listing contains both different prices, but DedupedListingMat still has one sale, not two.
- Impact: a no-longer-matching sale stays hidden and every materialized-view statistic uses the wrong population, until someone happens to run successful clustering/update. Reparse may be the sole operation correcting historic raw records.
- Recommendation: invalidate/recompute clusters whenever match facts change, before publishing the new snapshot. Cover every writer and partial committed batches, preserve the original failure, and do not publish known stale clusters if recomputation fails. Include changes to address/date/price/area/rooms and clusters inherited through exact keys.
- Evidence: three real-DB CLI assertion failures in `scraper-probes.log`; functions `test_explicit_correction_publishes_split_sale` (2 cases), `test_reparse_correction_publishes_split_sale` in `test_whole_audit1_probe.py`.

### B58 — P1 — A future sale permanently advances the update cutoff past real sales

- Locations: `scraper/src/scraper/run.py:200`, `:224`; `crawl_state.py:20`; both source parsers accept representable future sale dates.
- Reproduction: a normal Hemnet card dated 2099-01-01 passes the actual parser. A fixture-backed `update --source hemnet --district ostermalm`, yielding it plus an ordinary current-date sale, exits 0. It persists completeThrough=2099-01-01. The next `update_window` returns since=2098-12-25 on the actual 2026-10-25 test day.
- Impact: all current real sales are now before the crawl cutoff. Ordinary successful/empty retries cannot repair the future watermark, so one erroneous source date causes ongoing lost ingestion for that district/source.
- Recommendation: reject or quarantine future source dates against Stockholm's day and defensively bound coverage writes. Recover already-poisoned durable state without treating its future `since` as a safe fallback; avoid claiming unobserved coverage. Test both sources, existing bad watermarks and current Stockholm midnight boundaries.
- Evidence: actual parser -> CLI -> persisted ScrapeRun -> next-window assertion in `future-probe.log`, saved Python probe.

### F43 — P2 — Delayed data creates visible map layers despite hidden/mode state

- Locations: `web/src/components/HeatmapMap.tsx:221`, `:279`, `:336` (visibility effect only depends on mode, showHeatmap and styleReady).
- Reproduction: mount with showHeatmap=false, allow the style load event before resolving the heatmap fetch, then resolve one valid feature. addLayer creates default-visible price-points after the visibility effect already ran. Both price and frequency initial modes fail. The same ordering can follow layer removal/recreation after clearing data or retrying.
- Impact: shared `heatmap=0` URLs visibly contradict the checkbox; frequency mode can also expose price dots when data arrives after style readiness.
- Recommendation: initialize and reapply visibility whenever layers are added/rebuilt. Keep camera transitions separate so data refreshes do not unnecessarily restart the camera.
- Evidence: two mounted React component assertion failures, delayed fetch and no-network Mapbox stub, `wholeAudit1.map.test.tsx`, `map-probes.log`. `vitest.audit.mts` disables CSS PostCSS processing only for this isolated component probe. No production source was modified. This does not claim a live-provider/WebGL visual test.

### New — P2 — Insights' 7+ room segment omits 8–15 rooms

- Locations: `web/src/lib/aggregations.ts:441`, `:450`; `web/src/app/insights/page.tsx:169`.
- Reproduction: seed three otherwise identical priced sales with rooms 7, 8 and 15. `roomsBreakdown()` returns the row displayed as “7+” with count 1, not 3. The latter two rows are absent from the breakdown entirely, though current ingestion accepts them.
- Recommendation: group `LEAST(FLOOR(rooms), 7)` over accepted room values, or explicitly expose separate ranges and accurate labels. Counts, area/price means and median must use the same population.
- Evidence: first DB probe in `whole-audit1.test.ts`, `sql-probes.log` (expected 3, actual 1).

### New — P2 — Rising/falling headings do not match the mover populations

- Locations: `web/src/lib/aggregations.ts:380`; `web/src/app/insights/page.tsx:120`.
- Reproduction: one eligible street has 10 prior-window sales at 100k/m² and 5 recent sales at 120k/m². Both topMovers('up') and topMovers('down') return it; the “Fallande gator” card therefore shows +20%. The opposite happens with only falling candidates.
- Recommendation: filter by sign before LIMIT, with an explicit rule for zero, or use genuinely neutral highest/lowest-change titles. Do not merely remove wrongly signed rows after limiting.
- Evidence: second real-DB probe in `whole-audit1.test.ts`, `sql-probes.log`.

### New — P2 — Narrow summary cards visibly clip their content

- Locations: `web/src/components/StatCard.tsx:25` and `:29`; `SummaryCards.tsx:24`.
- Reproduction: production page `/street/ostermalm/karlavagen/2`, width 320px, fully loaded. Two-column cards leave 88px text content width with p-5 and 28px values. Karlavägen needs 144px; the ancestor overflow-hidden visibly cuts the street name. The Försäljningar heading is also clipped. Numeric paragraphs overflow their own content box, although some numbers fit into padding; the report is based on the visibly cut name/heading, not every measured paragraph.
- Recommendation: responsive single-column cards, padding/type sizing, or safe word wrapping that preserves full labels and values. Keep page-overflow checks, but add checks for actual content clipping inside cards.
- Evidence: both browser projects reproduce at 320px in `whole-audit1.spec.ts`; `browser-probes.log`; visually inspected `narrow-address.png`. Distinct from optional F39's grid empty-cell issue.

### New — P2 — Latitude-only source rows are never geocoded

- Locations: `scraper/src/scraper/geocode.py:266`, `:285`; parser coordinate passthrough in `hemnet.py:144`.
- Reproduction: actual Hemnet parser accepts a card with coordinates={lat:59.33}. Upsert stores lat=59.33/lng=NULL/status=pending. `geocode_pending`, supplied a hermetic successful HTTP transport, makes zero requests and returns ok=0 without error. Repeated passes leave the row permanently absent from the heatmap.
- Recommendation: select and guard any incomplete pair (`lat IS NULL OR lng IS NULL`), while preserving rows concurrently repaired with complete coordinates. Normalizing new incomplete pairs to both NULL is useful but must also address legacy partial pairs.
- Evidence: parser -> real DB upsert -> mock-transport geocoder assertion in `geocode-probe.log`, saved Python probe.

### New — P2 — Invalid complete inline coordinates reach the public map API

- Locations: `scraper/src/scraper/hemnet.py:144`, `booli.py:221`, `db.py:128`; `web/src/lib/aggregations.ts:778`.
- Reproduction: actual Hemnet parser accepts coordinates lat=91/lng=181 and stamps geocodedAt. The DB preparation classifies any non-null pair as inline. Independently, seed that pair through the sanctioned test helper: `heatmapPoints()` returns it because it checks only NOT NULL. The API consequently produces an out-of-world point; it is ineligible for geocoder repair.
- Recommendation: normalize inline coordinates to a complete finite geographically valid pair or an unknown pair eligible for repair, and exclude invalid legacy coordinates at the map SQL boundary. Treat absent/invalid coordinates as coordinate failure rather than losing an otherwise useful priced sale. Test both sources, numeric types, NaN/infinity and partial pairs.
- Evidence: `inline-coordinate-probe.log`, saved Python probe, third DB probe in `whole-audit1.test.ts` / `sql-probes.log`. No live source data prevalence or live renderer behavior was measured; invalid input acceptance and output are directly proven.

## Whole-scope coverage

`coverage-files.txt` inventories 144 production, schema, configuration and tooling files covered by current-source inspection. This is not a claim of 100% execution coverage. Areas examined:

- Every scraper production module: browser/crawl lifecycle and retry/cache behavior; both source extractors and parsers; normalization and precision; bounded/repeated pagination; all CLI commands, batching and failure paths; DB upserts; exact/fuzzy matching; reparse and pruning; durable checkpoints/resume/update watermarks; flock; geocoder retry/status/budgets; snapshot refresh and post-commit notification. Protected real state/cache/env files were not opened.
- Prisma schema and migration sequence, especially the latest effective dedup view, snapshot/index rebuilds, refresh lock timeout, slug trigger/parity and durable state constraints. Earlier replaced view definitions were cross-checked against the current effective definition, not treated as current runtime.
- All aggregation functions, SQL parameter binding, date/room/median/count populations, route validators and every API handler, typed API contracts, tag cache serialization/bounds/error behavior and revalidation authentication. No user-derived SQL interpolation or scraped HTML injection was found in these current paths.
- Every app route/layout, metadata, sitemap, social image, loading/error/404 boundary and global CSS; map filters, layer lifecycle, legend, popups, drawer fetch keys/chart/tooltip/modal behavior; analytics charts, tables, comparison/search navigation, accessibility and Swedish copy. Chart series identity, low-n treatment, time gaps, same-day address observations and URL state were examined.
- Test DB guard helpers, pytest isolation and fixtures, vitest/Playwright configuration, automatic exact-origin browser proxy including redirect and abort handling, failure/recovery tooling, screenshot helper, perf DB isolation, package/build settings, check/merge scripts. No skipped/failing production-test pins were found by the bounded source search.

## Independent validation and limits

- New failure evidence: 3 stale-cluster CLI cases; 1 future-watermark case; 1 partial-coordinate geocoder case; 1 invalid-inline-coordinate parser case; 2 delayed-map-layer cases; 3 SQL population/bounds cases; 2 real-browser narrow-card cases. Tests intentionally assert expected behavior and fail on this immutable candidate. No artificial parent/reversion tests were used for this whole-source audit.
- Independent production build succeeded after moving the temporary stub-heavy component probe out of the build's lint scan. The earlier build rejection concerned `any` types in that temporary reviewer test, not candidate code.
- Supplemental selected suites: 387 pytest cases (source characterization, pagination, ingestion bounds, geocoder, batch upserts, durable state, refresh); 127 integration vitest cases (API validation, cache, segmentation, Stockholm dates, slugs); 16 hermetic network Playwright cases.
- Production-browser audit flow passed on desktop and mobile: annual room-filtered district -> native chart table -> Ctrl-K search -> street -> compare -> add district via keyboard, with no console errors. Percent-containing unknown address returned HTTP 404 in both projects; the suspected malformed-address issue was therefore not reported. Narrow content clipping was only asserted after waiting for the actual address heading and capturing the page.
- An initial exploratory browser run overlapped another own suite on the isolated DB and was discarded. Browser and supplemental pytest evidence were rerun serially; the saved logs contain the authoritative runs.
- Existing readiness gate supplied by root was not a substitute for reasoning or the probes. I did not repeat a full gate or a 200k-row performance run. No live Hemnet/Booli/Mapbox calls, paid geocoding, protected .env/.state/.cache access, dev-DB mutations or process kills occurred. Fixture source iterators and HTTP transports provide the ingestion/geocoder evidence; real Mapbox tiles/WebGL rendering are a limitation.
- B16 storage terms remains the recorded owner decision, not a newly discovered code defect. Existing optional B28/B29/B47/B54/B55/F24/F25/F39/F41/F42 were not recounted as new findings. In particular >8 comparison palette reuse, drawer traversal order and the scatter unit duplicate remain their recorded optional items.

## Reproduction

Create a detached scratch worktree at the candidate; install its pinned web/Python dependencies. Copy the saved Python probe into `scraper/tests/`, SQL probe into `web/tests/integration/`, map probe into `web/src/components/`, browser probe into `web/e2e/`, and vitest.audit.mts into `web/`. Do not run DB suites concurrently. Use dedicated names/ports; these audit logs used `TEST_DB_NAME=bostadspriser_test_r_audit1 E2E_PORT=3119`.

```
# From scraper/
uv run pytest -q tests/test_whole_audit1_probe.py
# From web/
pnpm exec vitest run --project integration tests/integration/whole-audit1.test.ts
pnpm exec vitest run -c vitest.audit.mts --project unit src/components/wholeAudit1.map.test.tsx
# Move the stub-heavy temporary map probe outside src before a production build.
pnpm e2e:build
pnpm exec playwright test e2e/whole-audit1.spec.ts
```

Export the isolation variables for every invocation. The Python probe imports the candidate's existing `tests.test_cluster._row` fixture helper. New finding probes and logs are saved here, not committed. Scratch cleanup status is recorded in `cleanup.txt`.

**New P0/P1 count: 2. Clean-round contribution: zero.** After corrections are integrated and freshly reviewed, two consecutive fresh whole-code rounds with no new P0/P1 are still required.
