# Review: c396c2c — P0.4

**CHANGES REQUESTED**

Reviewed immutable c396c2c04b65a9bc450b050ae7ad7939733b49a7 in detached scratch `/tmp/r-docs-hardening/source`; only CLAUDE.md changes. No implementer/main edits. Scratch worktree removed after review.

1. **Major — CLAUDE.md:81: refresh guarantee exceeds the implementation.** `backfill-dedup` can commit batch one (`scraper/src/scraper/backfill.py:49`), then fail in batch two. Its wrapper calls `refresh_deduped()` only after the worker returns (`run.py:513`), so that failure leaves the snapshot/cache stale. Independently, `db.py:refresh_deduped()` deliberately returns `busy`/`failed` without aborting ordinary writers; successful refresh is not guaranteed. **Fix:** document best-effort refresh attempts, qualify which partial-failure paths are covered, and explicitly retain `refresh-view` recovery. Track the uncovered backfill-dedup failure path separately; do not silently change runtime under this docs commit.

2. **Minor — CLAUDE.md:88: two module responsibilities are wrong.** An agent following the new map to change historical backfill or page limits is directed to the wrong code. `backfill.py` only fills missing dedup keys (`backfill_dedup_keys`); historical orchestration is `run.py:backfill`. `pagination.py` only computes `card_key`; `source_base.py:crawl` enforces the page ceiling/repeated-page stop. **Fix:** name these actual responsibilities, adding `run.py` to the map.

3. **Minor — CLAUDE.md:71: canonical-key fallback omits inherited clusters.** Given a clustered row and a newly ingested exact copy whose own clusterId is null, the documented `clusterId → dedupKey → id` rule implies separate groups. Actual SQL first inherits `MIN(clusterId)` from any row sharing the dedupKey, then falls back to dedupKey/id (`20261024100000_street_slug/migration.sql:36`). **Fix:** state own clusterId → same-dedupKey inherited clusterId → dedupKey → id. This is an existing regression-prevention contract, not a cosmetic detail.

Verification: traced every changed claim/command against c396c2c source: CLI options/durable checkpoints, refresh/cache/revalidation, module implementations, schema/migrations/shared vectors, E2E fixtures/proxy/config/local probes, heatmap query and the three changed page descriptions. Other changed claims match. `git diff --check c396c2c^ c396c2c` passed. Full gate was not rerun for docs-only changes; parent supplied green 527 Vitest / 316 e2e / 759 pytest evidence. No provider calls, database connections, protected paths, or processes touched.

Proving test without fix: **N/A**, documentation-only commit; no artificial production reversion. A stdlib-only control-flow probe below executes the exact undecorated command body with a simulated committed-then-failing worker. `python3 /tmp/r-docs-hardening/probe_refresh_claim.py` fails the advertised refresh assertion, printing `['committed first batch']`; it does not claim to reproduce a real database failure.

Proposed new backlog item: ensure `backfill-dedup` attempts refresh after earlier committed batches when a later batch fails; cover it with a failing-first isolated-DB test and preserve the original failure. This runtime fix is separate from correcting the documentation claim.

```python
import ast
import subprocess

# Execute the exact command body, without decorators/imports or external I/O.
source = subprocess.check_output(["git", "-C", "/tmp/bostadspriser-final-candidate",
                                  "show", "c396c2c:scraper/src/scraper/run.py"], text=True)
node = next(n for n in ast.parse(source).body
            if isinstance(n, ast.FunctionDef) and n.name == "backfill_dedup")
node.decorator_list = []
events = []
def fail_after_commit():
    events.append("committed first batch")
    raise RuntimeError("second batch failed")
namespace = {"backfill_dedup_keys": fail_after_commit,
             "refresh_deduped": lambda: events.append("refresh attempted")}
exec(compile(ast.Module(body=[node], type_ignores=[]), "c396c2c:scraper/src/scraper/run.py", "exec"), namespace)
try:
    namespace["backfill_dedup"]()
except RuntimeError:
    pass
print(events)
assert "refresh attempted" in events, "CLAUDE.md:81 later-failure refresh claim is false"
```
