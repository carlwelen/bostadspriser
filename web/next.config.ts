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
  // Next counts serialized payload bytes; heap overhead is additional.
  cacheMaxMemorySize: 16 * 1024 * 1024,
  experimental: {
    // Keep Next's data cache (unstable_cache, see src/lib/cache.ts) in memory
    // only. On disk it grows without bound (some cached queries are keyed by
    // URL input), is never cleaned, and would outlive restarts and re-seeds.
    // In memory it is an LRU bounded by cacheMaxMemorySize (16 MiB serialized payload).
    isrFlushToDisk: false,
  },
};

export default nextConfig;
