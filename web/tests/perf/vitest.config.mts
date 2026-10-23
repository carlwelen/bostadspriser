import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Performance measurements (B21). NOT part of the gate: run explicitly with
//
//   TEST_DB_NAME=bostadspriser_test_c pnpm perf
//
// It uses its own database, "<TEST_DB_NAME>_perf" (default
// bostadspriser_test_perf), which is created, migrated and filled with ~200k
// synthetic listings on first use. See docs/perf.md.
const base = process.env.TEST_DB_NAME || "bostadspriser_test";
process.env.TEST_DB_NAME = `${base}_perf`;

const { testDatabaseUrl } = createRequire(import.meta.url)("../../scripts/test-db.cjs");

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } },
  test: {
    name: "perf",
    include: ["tests/perf/**/*.perf.ts"],
    root: fileURLToPath(new URL("../..", import.meta.url)),
    environment: "node",
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 600_000,
    globalSetup: ["tests/perf/setup.ts"],
    env: { DATABASE_URL: testDatabaseUrl() },
  },
});
