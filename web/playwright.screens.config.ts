import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Screenshot capture for UI tasks (not part of the gate):
//   pnpm e2e:build
//   SCREENS_ID=F1 SCREENS_PATHS=/district/ostermalm,/insights pnpm screens
// Writes docs/screens/<ID>-<path-slug>-<desktop|mobile>.png against the seeded
// test database, using the same server setup as the e2e suite.
export default defineConfig({ ...base, testDir: "screens" });
