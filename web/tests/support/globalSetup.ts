import { ensureTestDb } from "../../scripts/test-db.cjs";

// Migrate (and create, if missing) the integration-test database once per run.
// scripts/check.sh does a full drop+recreate first; running `pnpm test:int`
// on its own only applies pending migrations.
export default function setup() {
  ensureTestDb();
}
