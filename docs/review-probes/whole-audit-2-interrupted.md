# Whole-code audit 2: interrupted findings

Candidate: `60e547d2800a24e43c16560f6f01a18a9313c6e7`.
Reviewer: fresh read-only gpt-6-astra role R, interrupted at the user's request.
The orchestrator preserved these findings from reviewer messages and artifacts.
This is not a completed coverage report or an approval. Clean P0/P1 streak: **0**.

The candidate's full gate passed: **568 Vitest, 372 browser, 894 pytest**.
Independent Python probes produced **8 failures** in 1.63 seconds on the candidate.
Probe source is preserved in [audit2_python_probe.py](audit2_python_probe.py).
Copy it into the candidate's `scraper/tests/` in an isolated scratch worktree to run
with `TEST_DB_NAME=bostadspriser_test_r_audit2 E2E_PORT=3118 uv run pytest -q -s
tests/test_audit2_probes.py`. All source fetches and geocoder lookups are mocked;
the probes use a real test database and never contact live providers.

## B64 — P1: malformed payload advances complete coverage

Both source extractors return an empty list for missing closing script tags or
invalid embedded JSON. `source_base.crawl` interprets that as a verified terminal
page. The real source readiness checks accept the malformed probe payload.

With a valid May 2 sale on page 1, malformed page 2, an unread April 9 sale on
page 3, and an April 1 initial cutoff, the run fetches only pages 1 and 2, reports
no error and records complete coverage through May 2. The next update's overlap
starts April 25, permanently missing the older sale.

Four independent cases fail: both sources, with and without a closing script tag.
Distinguish malformed/unrecognized data from verified empty results, report an
incomplete crawl and preserve the last successful durable cutoff.

## B65 — P2: late geocode failure leaves committed coordinates unpublished

The geocoder commits 100 successful coordinate updates, then a later write fails.
Its summary never returns, so the CLI's finally block does not know about the
successful batch. The CLI exits 1 with the original error, but `Listing` has 100
geocoded rows while `DedupedListingMat` has zero.

Report committed writes after every successful flush and refresh in the CLI's
finally block while preserving the original failure and avoiding refresh for
rolled-back writes.

## B66 — P2: address correction keeps old coordinates

Correcting a row from Brahegatan 3A to Götgatan 80, Södermalm, without incoming
coordinates retains the old coordinates and `geocodeStatus=ok`. The corrected
address is published at the old location and is excluded from pending geocoding.

Cover single upsert, duplicate collapse inside a batch and reparse. Invalidate
coordinates only when canonical location dependencies change without a valid
replacement pair. Preserve coordinates for equivalent spelling/floor changes
and preserve newer complete inline pairs.

## B67 — P2: oversized source price aborts a valid batch

Both sources accept a final price of `100000000000000000000` when the separately
provided price per square metre is plausible. PostgreSQL rejects the bigint
insert and rolls back the valid neighboring row in the same transaction.

Two independent probes fail. Validate the representable stored integer range
before batching and retain the existing stricter business bounds where applicable.

## F48 — P2: dense analytics tooltip exceeds the viewport

Twelve valid comparison series (four districts and eight streets) produce an
874px tooltip. Measured bounds: y=140..1014 at 320×568, and y=432..1306 at
1280×720. Overflow is visible and there is no scrolling, so the lower series'
median, mean and sample size cannot be read. A data-table fallback exists.

Keep every series, constrain the tooltip to visible bounds and support actual
pointer/wheel and keyboard entry, scrolling, exit and focus return. Preserve
chart animations and navigation. Do not impose an unrelated series cap.

Reviewer artifacts remain in `/tmp/r-whole-audit-2/`: `ui-probe.mjs`,
`ui-probe.log`, `dense-tooltip-320.png`, `dense-tooltip-1280.png`,
`python-probes-expanded.log` and `full-gate.log`. The F48 worktree was interrupted
before implementation and is clean at the candidate commit.

## Remaining review work

The round was interrupted. Further probes (including house routing and SQL/API
population checks) were exploratory and have no final finding verdict here.
Do not count this audit as clean or complete. The latest user instruction stops
sub-agents; the fresh-review requirement is recorded as an owner decision in the
backlog rather than silently replaced with self-review.
