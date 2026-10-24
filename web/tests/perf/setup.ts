import { ensureTestDb } from "../../scripts/test-db.cjs";

// Create the perf database if needed and apply all migrations (same helper as
// the integration tests; TEST_DB_NAME was already switched to "<name>_perf" by
// vitest.config.mts, which also checks the name contains a "test" segment).
export default function setup() {
  ensureTestDb();
}
