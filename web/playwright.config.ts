import { defineConfig, devices } from "@playwright/test";
import { testDatabaseUrl } from "./scripts/test-db.cjs";

// Smoke e2e against a production build (`pnpm e2e:build`, output in
// .next-e2e/, built with an empty NEXT_PUBLIC_MAPBOX_TOKEN so Mapbox is never
// contacted). The server talks to the seeded test database; the global setup
// migrates and seeds it. E2E_PORT lets parallel worktrees avoid collisions.
const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${port}`;
const databaseUrl = testDatabaseUrl();

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `pnpm exec next start -H 127.0.0.1 -p ${port}`,
    url: `${baseURL}/robots.txt`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATABASE_URL: databaseUrl, NEXT_DIST_DIR: ".next-e2e", NODE_ENV: "production" },
  },
});
