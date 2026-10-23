import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Loaded at runtime, not bundled: Vite's config bundler mangles the helper's
// own requires when the repo path contains spaces.
const { testDatabaseUrl } = createRequire(import.meta.url)("./scripts/test-db.cjs");

// Two projects:
//   unit         — pure functions, colocated as src/**/*.test.ts(x). No DB.
//   integration  — aggregations + route handlers against a real, migrated
//                  Postgres test database (see scripts/test-db.cjs). Files run
//                  serially because each one reseeds the same database.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    coverage: {
      provider: "v8",
      include: ["src/lib/**", "src/app/api/**"],
      reporter: ["text-summary", "text"],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.{ts,tsx}"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/support/globalSetup.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
          env: { DATABASE_URL: testDatabaseUrl() },
        },
      },
    ],
  },
});
