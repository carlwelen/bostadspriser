# P0.4 documentation re-review

**APPROVE** the ordered stack `c396c2c` → `9d670ed`.

- `c396c2c04b65a9bc450b050ae7ad7939733b49a7`: approved with the required correction below; not approved independently.
- `9d670ed22a937f5e833f2f2d4f0caab725ba902c`: **APPROVE**. No remaining findings in the changed documentation.

Reviewed immutable `git show` content from `/tmp/bostadspriser-final-candidate`, not its staged preparation. Read repository instructions, reviewer brief, backlog and the prior report. No source/index/main edits.

The three prior findings are resolved:

1. `CLAUDE.md:81` now describes best-effort refresh, possible stale snapshots, explicit `refresh-view` recovery and the separate B56 partial-failure follow-up. It does not claim that B56 is already implemented in this tree or guarantee refresh success. `db.py:180–207` and `run.py:589–603` support the wording. The new README and perf wording likewise matches the post-commit notification path and its nonfatal failures.
2. `CLAUDE.md:88` correctly assigns historical orchestration to `run.py`, dedup-key filling to `backfill.py`, pagination guards to `source_base.py`, and card identities to `pagination.py`.
3. `CLAUDE.md:71` includes the same-dedupKey inherited cluster between own clusterId and dedupKey/id, matching the canonical-view migration.

Also traced the stack's changed CLI options, durable checkpoints/watermarks, reparse pruning, street-slug trigger/shared vectors, test database guards, E2E fixture/proxy restrictions, cache bounds and uncached misses, heatmap cap, and page descriptions against immutable source. No new backlog item is needed; B56 already tracks the runtime gap and is a separate review/merge.

Validation: `git diff --check c396c2c^ 9d670ed` passed. Proving-test reversion: **N/A**, documentation-only changes. Did not rerun the runtime gate; inspected `/tmp/final-candidate-e-gate.log`, which reports 539 Vitest, 338 Playwright and 759 pytest passing, plus typecheck/lint/build/ruff. That is the supplied combined-candidate gate evidence, not a claim that this reviewer reran it at immutable 9d670ed.

No scratch worktree, database connection, provider request, protected-path access or process was created; no scratch cleanup remains.
