// Test-database helper shared by vitest, Playwright and scripts/check.sh.
//
// Every test suite runs against its own database, never the dev database.
// Resolution order for the URL:
//   1. TEST_DATABASE_URL, verbatim.
//   2. DATABASE_URL (env or the repo-root .env) with the database name swapped
//      for TEST_DB_NAME (default "bostadspriser_test").
// Whatever the source, the database name must contain a "test" segment
// (`bostadspriser_test`, `bostadspriser_test_b`, ...) or we refuse to touch it.
//
// CLI:
//   node scripts/test-db.cjs url     # print the resolved URL
//   node scripts/test-db.cjs ensure  # create if missing + prisma migrate deploy
//   node scripts/test-db.cjs reset   # DROP DATABASE ... WITH (FORCE), then ensure
//
// CommonJS on purpose: Playwright loads its config through a CJS transform.

/* eslint-disable @typescript-eslint/no-require-imports */
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const nextEnv = require("@next/env");

const WEB_DIR = path.resolve(__dirname, "..");
const FALLBACK_URL = "postgresql://bostadspriser:bostadspriser@localhost:5432/bostadspriser";
const TEST_NAME_RE = /(^|_)test(_|$)/;

let loaded = false;
function loadRootEnv() {
  if (loaded) return;
  loaded = true;
  const quiet = { info() {}, error() {} };
  nextEnv.loadEnvConfig(WEB_DIR, false, quiet);
  nextEnv.loadEnvConfig(path.resolve(WEB_DIR, ".."), false, quiet);
}

/** Throws unless `url` points at a database whose name marks it as a test DB. */
function assertTestUrl(url) {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!TEST_NAME_RE.test(name)) {
    throw new Error(
      `refusing to use database "${name}" for tests: the name must contain a "test" segment`
    );
  }
  return name;
}

function testDatabaseUrl() {
  loadRootEnv();
  const explicit = process.env.TEST_DATABASE_URL;
  const url = explicit
    ? new URL(explicit)
    : new URL(process.env.DATABASE_URL || FALLBACK_URL);
  if (!explicit) url.pathname = `/${process.env.TEST_DB_NAME || "bostadspriser_test"}`;
  // A pathological query (a refresh that stalls, a lock that is never released)
  // should fail the test after a minute instead of hanging the suite. Set
  // TEST_DB_STATEMENT_TIMEOUT_MS=0 to disable (the perf run does).
  const timeoutMs = process.env.TEST_DB_STATEMENT_TIMEOUT_MS ?? "60000";
  if (!/^\d+$/.test(timeoutMs)) {
    throw new Error(
      `TEST_DB_STATEMENT_TIMEOUT_MS must be a non-negative integer (milliseconds), got "${timeoutMs}"`
    );
  }
  if (timeoutMs !== "0") {
    // Append to any `options` the URL already has. Spaces must be %20, not the
    // "+" URLSearchParams would write: libpq-style clients (psql, psycopg) don't
    // decode "+" and reject the option.
    const existing = url.searchParams.get("options");
    const options = `${existing ? `${existing} ` : ""}-c statement_timeout=${timeoutMs}`;
    const rest = new URLSearchParams(url.search);
    rest.delete("options");
    url.search = [rest.toString(), `options=${encodeURIComponent(options)}`].filter(Boolean).join("&");
  }
  const out = url.toString();
  assertTestUrl(out);
  return out;
}

/** Create the test database if needed and apply all Prisma migrations. */
function ensureTestDb() {
  const url = testDatabaseUrl();
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: WEB_DIR,
    env: { ...process.env, DATABASE_URL: url },
    stdio: ["ignore", "pipe", "inherit"],
  });
  return url;
}

/** Drop and recreate the test database from migrations. Test DBs only. */
function resetTestDb() {
  const url = testDatabaseUrl();
  const name = assertTestUrl(url);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  execFileSync(
    "pnpm",
    ["exec", "prisma", "db", "execute", "--url", admin.toString(), "--stdin"],
    {
      cwd: WEB_DIR,
      input: `DROP DATABASE IF EXISTS "${name}" WITH (FORCE);`,
      stdio: ["pipe", "pipe", "inherit"],
    }
  );
  return ensureTestDb();
}

module.exports = { assertTestUrl, testDatabaseUrl, ensureTestDb, resetTestDb };

if (require.main === module) {
  const cmd = process.argv[2] ?? "url";
  if (cmd === "url") console.log(testDatabaseUrl());
  else if (cmd === "ensure") console.log(`migrated ${ensureTestDb()}`);
  else if (cmd === "reset") console.log(`reset ${resetTestDb()}`);
  else {
    console.error(`unknown command: ${cmd} (expected url|ensure|reset)`);
    process.exit(2);
  }
}
