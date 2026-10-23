import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// The repo keeps a single `.env` at the root (shared with the scraper). Next
// only reads env files from `web/`, so pull the root one in as a fallback;
// variables already set in the environment or in `web/.env*` win.
loadEnvConfig(path.resolve(__dirname, ".."));

const nextConfig: NextConfig = {
  // The e2e suite builds into its own directory so it never clobbers a
  // running `pnpm dev` (see scripts/check.sh).
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
